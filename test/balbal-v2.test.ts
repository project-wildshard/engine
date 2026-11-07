import { originalSpeciesJson } from './fixtures/nalati-original-species';
import { originalSpeciesBlob } from './fixtures/nalati-original-species-blob';
import { heldModuleBytes, heldWitnessBytes, lendNalatiHeld } from './fixtures/nalati-return-modules';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { array, boolean, literal, number, object, parse, strictObject, string } from 'valibot';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { app } from '../src/client/engine/app/runtime';
import type { Animal } from '../src/client/engine/entities/AnimalView';
import type { ThinkCtx } from '../src/shared/engine/entities/species/registry';
import type { DamageRequest } from '../src/shared/engine/combat/pipeline';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { BALBAL_SPECIES } from './fixtures/projectedCreature';
import { BALBAL_SPECIES as ORIGINAL } from './fixtures/originalBalbal';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { CreatureGuestSchema } from '@wildshard/format/speciesBookRows';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { originalHeldMetadata } from './fixtures/nalati-held-original';
import { scriptAdmissionRows, decisionModuleContracts } from '@wildshard/format/scriptContract';
import { ReturnProjectionV2Schema, parseReturnProjectionV2 } from '@wildshard/format/returnProjectionV2';
import { nameBlob } from '../src/sharddev/blobs';
import { NALATI_SCRIPT_SECTIONS } from './fixtures/nalati-script-inventory';

const { held, stealth } = originalHeldMetadata();

const generated=parse(object({presentation:object({guest:CreatureGuestSchema}),
  program:strictObject({...ReturnProgramSchema.entries,v2:ReturnProjectionV2Schema})}),
  originalSpeciesJson('species.json'));

function controls(row: typeof BALBAL_SPECIES): Required<Pick<typeof row, 'think' | 'damageMul'>> {
  if (row.think === undefined || row.damageMul === undefined) throw new Error('Missing native creature binding');
  return { think: row.think, damageMul: row.damageMul };
}
function fixture(memory: Record<string, number>) {
  const trace: (number | string | undefined)[][] = [];
  let speed = 0, age = -1, duration = 1, phase = -1;
  const body = legacyDouble<Animal>({
    entityId: 'fixture.stone', kind: 'stone-guardian', mem: { ...memory }, position: new Vector3(), yaw: 0,
    scale: 1.18, yOffset: .3, state: 'idle', get attackPhase() { return phase; }, lookTarget: new Vector3(), lookWeight: 0,
    startAttack: seconds => { trace.push(['start', seconds]); age = 0; duration = seconds; phase = 0; },
    cancelAttack: () => { trace.push(['cancel']); age = -1; phase = -1; },
    setMotion: (yaw, value, turn) => { trace.push(['motion', yaw, value, turn]); body.yaw = yaw; speed = value; },
  });
  const context = legacyDouble<ThinkCtx>({ dt: .02, t: .02, player: new Vector3(0, 0, 1), calm: false,
    steer: (_actor, yaw, value, turn) => { trace.push(['steer', yaw, value, turn]); body.yaw = yaw; speed = value; },
    reach: () => true, hurt: damage => { trace.push(['hurt', damage]); }, sound: cue => { trace.push(['sound', cue]); },
  });
  const advance = (): void => {
    body.position.x += Math.sin(body.yaw) * speed * context.dt;
    body.position.z += Math.cos(body.yaw) * speed * context.dt;
    if (age >= 0) { age += context.dt; phase = age / duration; }
  };
  const snapshot = (): unknown => ({ mem: { ...body.mem }, position: body.position.toArray(), yaw: body.yaw,
    state: body.state, attack: body.attackPhase, look: body.lookTarget.toArray(), weight: body.lookWeight, trace: structuredClone(trace) });
  return { body, context, trace, advance, snapshot, setAttack: (value: number): void => { phase = value; } };
}
function owner(): Scope {
  const scope = new Scope('fixture.balbal-v2'); lendNalatiHeld(scope); scope.expose(app, 'levelScope', scope); scope.expose(app, 'equipment', null); return scope;
}

test('Balbal ABI2 preserves the frozen callback trace, twenty defaults and original memory continuation', () => {
  const scope = owner(), actual = controls(BALBAL_SPECIES), oracle = controls(ORIGINAL);
  try {
    const memories: Record<string, number>[] = [{}, { field: 1, rise: 0 }, { init: 1, field: 1, minX: -2, maxX: 2, minZ: -2, maxZ: 2 }];
    for (const memory of memories) {
      const a = fixture(memory), b = fixture(memory);
      for (let tick = 0; tick < 1000; tick++) {
        const time = (tick + 1) * .02;
        for (const f of [a,b]) {
          f.context.t = time; f.context.calm = tick >= 400 && tick < 500;
          f.context.player.set(Math.sin(tick * .013) * 3, tick >= 600 && tick < 700 ? 12 : 0, Math.cos(tick * .017) * 3);
          f.body.mem['dawn'] = Number(tick >= 800);
        }
        oracle.think(b.body,b.context); actual.think(a.body,a.context);
        expect(a.snapshot()).toStrictEqual(b.snapshot());
        if (tick % 17 === 0) {
          const at = new Vector3(.4 + tick % 3,.8,1), request = legacyDouble<DamageRequest>({ sourceTags: tick % 2 === 0 ? ['weapon.javelin'] : ['weapon.sabre'] });
          expect(actual.damageMul(a.body,at,new Vector3(),request)).toBe(oracle.damageMul(b.body,at,new Vector3(),request));
        }
        a.advance(); b.advance();
      }
      expect(a.body.mem['balbalThinkAt']).toBe(b.body.mem['balbalThinkAt']);
      expect(a.body.mem['balbalPlayerX']).toBe(b.body.mem['balbalPlayerX']);
      expect(a.body.mem['balbalPlayerZ']).toBe(b.body.mem['balbalPlayerZ']);
    }
  } finally { scope.dispose(); }
});

test('ABI2 retains same-call native Wedge contact, reach refusal and both ordered sounds', () => {
  const scope = owner(), actual = controls(BALBAL_SPECIES), oracle = controls(ORIGINAL);
  try {
    for (const reach of [true,false]) for (const radius of [1,3.5 - 1e-9,3.5,3.5 + 1e-9]) for (const angle of [0,.96 - 1e-9,.96,.96 + 1e-9]) {
      const a = fixture({ init: 1, st: 3, hit: 0 }), b = fixture({ init: 1, st: 3, hit: 0 });
      for (const f of [a,b]) {
        f.setAttack(.55); f.context.dt = .1; f.context.t = 7;
        f.context.player.set(Math.sin(angle) * radius,0,Math.cos(angle) * radius);
        f.context.reach = () => reach;
      }
      oracle.think(b.body,b.context); actual.think(a.body,a.context);
      expect(a.snapshot()).toStrictEqual(b.snapshot());
      if (radius === 1 && angle === 0) {
        expect(a.trace.slice(-2)).toEqual([['sound','sailor_slash'],['sound','coconut_land']]);
        expect(a.trace.filter(row => row[0] === 'hurt')).toHaveLength(Number(reach));
      }
    }
  } finally { scope.dispose(); }
});

test('the selected creature artifact is admitted in the complete emitted inventory and leaves held ABI1 intact', async () => {
  const row = parse(ReturnProgramSchema,generated.presentation.guest.program), candidate = parseReturnProjectionV2(row.v2);
  expect(row.script).toEqual(generated.program.script); expect(row.bytes).toBe(generated.program.bytes);
  expect(held.program.bytes).toBe(generated.program.bytes); expect(held.program.script).toEqual(generated.program.script);
  const module = nameBlob('behaviour/nalati.held-weapons.wasm','wasm',heldModuleBytes,
    { dependencies:[hashImmutableBytes(heldWitnessBytes)],critical: true, script: { abi: 2, lane: 'project', pages: candidate.artifact.pages, ioBytes: candidate.artifact.ioBytes,
      compilerRevision: candidate.artifact.compilerRevision, admissionRevision: candidate.artifact.admissionRevision } });
  expect(candidate.bytes).toBe('');expect(row.bytes).toBe('');
  expect(held.compiled.source).toBe('behaviour/held-weapons.generated.wasm'); expect(held.compiled.bytes).toBe(heldModuleBytes.length);
  expect(hashImmutableBytes(heldModuleBytes)).toBe(held.compiled.hash);
  expect(held.program.v2).toEqual(row.v2); expect(stealth.program.v2).toEqual(row.v2);
  const rows = scriptAdmissionRows(NALATI_SCRIPT_SECTIONS);
  expect(new Set(rows.filter(item => item.side === 'sim').map(item => item.module)).size).toBe(8);
  expect(rows.some(item => item.module === module.file.path && item.abi === 2)).toBe(true);
  expect(decisionModuleContracts(rows,rows.map(item => item.module === module.file.path ? module.file : { kind: 'wasm', path: item.module, hash: item.module.slice(11,-5) })).get(candidate.artifact.hash)).toMatchObject({ abi:2,lane:'project' });
  const { output }=await import('./fixtures/nalati-output-original');
  const declaration=parse(object({name:string(),kind:literal('wasm'),source:string(),options:object({dependencies:array(string()),critical:boolean(),
    script:object({abi:literal(2),lane:literal('project'),pages:number(),ioBytes:number(),compilerRevision:literal(1),admissionRevision:literal(1)})})}),
    output.blobs.find(blob=>blob.name==='behaviour/nalati.held-weapons.wasm'));
  const actual=originalSpeciesBlob(declaration);
  if(actual===undefined)throw new Error('Missing original held executable source pin');
  expect(actual.bytes).toEqual(heldModuleBytes);expect(actual.file).toEqual(module.file);
  expect(actual.script).toEqual(module.script);
  const witness=parse(object({name:string(),kind:literal('bin'),source:string()}),output.blobs.find(blob=>blob.name==='behaviour/held-witness.bin'));
  const raw=originalSpeciesBlob(witness);
  if(raw===undefined)throw new Error('Missing original held witness source pin');
  expect(raw.bytes).toEqual(heldWitnessBytes);expect(actual.file.dependencies).toEqual([raw.file.hash]);
});

test('selected Balbal capture refuses missing fields and retired owners without native memory or effects', () => {
  const scope = owner(), actual = controls(BALBAL_SPECIES), a = fixture({});
  const program = ReturnProgram.page(generated.presentation.guest.program,scope);
  try {
    expect(() => program.project('think',{})).toThrow(); expect(a.body.mem).toEqual({}); expect(a.trace).toEqual([]);
    const retire = scope.disposeSteps(); retire.next();
    expect(() => actual.think(a.body,a.context)).toThrow(/disposed/);
    expect(a.body.mem).toEqual({}); expect(a.trace).toEqual([]);
    for (const step of retire) void step;
  } finally { scope.dispose(); }
});

test('every shared held, power, stealth and creature signal matches its unchanged ABI1 witness', () => {
  const scope = owner(), row = generated.program, modern = ReturnProgram.page(row,scope);
  const original = ReturnProgram.page({ script: row.script, bytes: Buffer.from(heldWitnessBytes).toString('base64') },scope);
  let accepted = 0;
  try {
    for (const signal of row.v2.signals) for (const scalar of [.125,.5,1]) {
      const fields = Object.fromEntries(row.v2.fields.map(name => [name,scalar]));
      let expected: Readonly<Record<string,number>> | undefined;
      try { expected = original.project(signal,fields); } catch { /* Both ABIs must refuse an invalid numeric frame. */ }
      if (expected === undefined) expect(() => modern.project(signal,fields)).toThrow();
      else { expect(modern.project(signal,fields)).toStrictEqual(expected); accepted++; }
    }
    expect(accepted).toBeGreaterThan(row.v2.signals.length);
  } finally { scope.dispose(); }
});


test('retirement from native contact reach cannot publish hurt or either sound',()=>{
  const scope=owner(),actual=controls(BALBAL_SPECIES),a=fixture({init:1,st:3,hit:0});
  a.setAttack(.55);a.context.dt=.1;a.context.t=7;
  a.context.reach=()=>{scope.dispose();return true;};
  try{expect(()=>actual.think(a.body,a.context)).toThrow('disposed');expect(a.trace.filter(value=>value[0]==='hurt'||value[0]==='sound')).toEqual([]);}
  finally{scope.dispose();}
});


test('AS request-tag policy retains legacy equipment fallback, visibility and stow precedence',()=>{
  type Equipment=NonNullable<typeof app.equipment>;
  const scope=owner(),actual=controls(BALBAL_SPECIES),oracle=controls(ORIGINAL);
  const tagSets:DamageRequest['sourceTags'][]=[[],['dmg.legacy'],['weapon.javelin'],['weapon.sabre'],['dmg.legacy','weapon.javelin']];
  const requests:(DamageRequest|undefined)[]=[undefined,...tagSets.map(sourceTags=>legacyDouble<DamageRequest>({sourceTags}))];
  const equipmentIds:Equipment['current']['row']['id'][]=['weapon.spear','weapon.sabre'];
  try{
    for(const id of equipmentIds)for(const visible of [true,false])for(const stowed of [true,false]){
      const loan=scope.child('equipment');
      const current=legacyDouble<Equipment['current']>({row:legacyDouble<Equipment['current']['row']>({id})});
      loan.expose(app,'equipment',legacyDouble<Equipment>({visible,stowed,current}));
      try{for(const request of requests){const a=fixture({open:1}),b=fixture({open:1}),hit=new Vector3(.4,1,1);expect(actual.damageMul(a.body,hit,new Vector3(),request)).toBe(oracle.damageMul(b.body,hit,new Vector3(),request));}}
      finally{loan.dispose();}
    }
  }finally{scope.dispose();}
});
