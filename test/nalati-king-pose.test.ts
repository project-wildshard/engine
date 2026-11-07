import { originalSpeciesJson } from './fixtures/nalati-original-species';
import { Scope } from '../src/shared/engine/app/scope';
import { lendNalatiHeld } from './fixtures/nalati-held-loan';
import { object, parse, record, string, unknown } from 'valibot';
import { NumericPoseSchema } from '@wildshard/format/clientChannels';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { numericCreaturePose } from '../src/shared/game/plugin/channelPrograms';
import { creatureFrame } from '../src/shared/game/plugin/creatureFrame';
import { parsePackedCreatureLooks } from '@wildshard/format/speciesLooks';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { Bone, Vector3 } from 'three';
import { setTerrainHeight } from '../src/shared/engine/world/terrainHeight';
import { expect, test } from 'vitest';
import type { AnimalRigContext } from '../src/shared/engine/entities/animalRig';
import { Rng } from '../src/shared/engine/core/rng';
import { nalatiSpeciesCatalogue } from './fake/nalatiSpecies';
import { animateKing } from './fixtures/nalati-king-pose';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import type { Animal } from '../src/client/engine/entities/AnimalView';
import type { RigAnimCtx } from '../src/shared/engine/entities/species/registry';
import { installNalatiSpeciesFixture } from './fixtures/nalati-species-world';

await installNalatiSpeciesFixture();

const speciesRows=parse(object({poses:record(string(),NumericPoseSchema),program:ReturnProgramSchema}),
  originalSpeciesJson('species.json'));

const names = ['body', 'spine', 'chest', 'head', 'crown', 'cape', ...['L', 'R'].flatMap(side =>
  ['sh', 'el', 'hand'].map(joint => `arm${side}_${joint}`).concat(['hip', 'knee', 'foot'].map(joint => `leg${side}_${joint}`)))];
function context(): AnimalRigContext & { bones: Record<string, Bone> } {
  const mem: Record<string, number> = {}, position = new Vector3(3, 140, 8);
  return { bones: Object.fromEntries(names.map(name => [name, new Bone()])), dims: { bodyY: 1, bodyHalfLen: 1, bodyRadius: .4, headRadius: .3, legLen: 1, feet: [], halfWidth: .4 },
    dt: 1 / 30, t: 1, seed: .7, scale: 1, speed: .4, strafe: .2, phase: .3, state: 'alert', alive: true,
    deathT: -1, flinch: .3, brace: .4, attack: -1, lookTarget: new Vector3(6, 142, 10), lookWeight: .7, position, yaw: .2, mem,
    animal: { mem, position, yOffset: 0 } };
}
function transforms(c: AnimalRigContext): number[] { return Object.values(c.bones).flatMap(b => [b.position.x, b.position.y, b.position.z, b.rotation.x, b.rotation.y, b.rotation.z, b.scale.x, b.scale.y, b.scale.z]); }

test('King pose rows retain every joint through the full fight and its reset', () => {
  let ground=0;setTerrainHeight(() => ground);
  // the King's frame is his packed look's channel frame
  const animateGoldenKing = nalatiSpeciesCatalogue().looks.find(look => look.kind === 'golden-king')?.animate;
  if (animateGoldenKing === undefined) throw new Error('Missing Golden King frame');
  const packed=parsePackedCreatureLooks(parse(object({looks:unknown()}),originalSpeciesJson('species.json')).looks);
  const frame=packed.frames['king'];if(frame===undefined)throw new Error('Missing admitted King frame');
  const nativeFrame=creatureFrame(frame,()=>ground);
  const actual = context(), native=context(), expected = context();
  for (const pose of [0, 1, 2]) for (const act of [0, 1, 2, 3, 4]) for (const strike of [0, 1, 2, 3])
    for (const attack of [-1, 0, .2, .55, .62, .72, .78, .88, 1]) for (const deathT of [-1, 0, .4, 1]) {
      ground=strike===0?-0:strike*3;
      for (const c of [actual, native, expected]) {
        Object.assign(c.mem, { pose, act, strike, floorY: 140, rise: .43, lift: .12, kneel: act === 3 ? 1 : 0,
          raise: act === 2 ? 1 : 0, cape: act === 4 ? .001 : 1, crown: strike === 3 ? 0 : 1 });
        c.attack = attack; c.deathT = deathT; c.alive = deathT < 0;
        c.t += .037; c.phase = (c.phase + .117) % 1; c.speed = Math.sin(c.t) * 2.4;
      }
      animateKing(expected); animateGoldenKing(legacyDouble<RigAnimCtx>({ ...actual, animal: legacyDouble<Animal>(actual.animal) }));
      nativeFrame(native);expect(transforms(native)).toEqual(transforms(actual));
      expect(native.mem).toEqual(actual.mem);expect(native.animal.yOffset).toBe(actual.animal.yOffset);
      const wanted = transforms(expected);
      transforms(actual).forEach((value, i) => expect(value, `${pose}/${act}/${strike}/${attack}/${deathT} scalar ${i}`).toBeCloseTo(wanted[i] ?? Number.NaN, 12));
      expect(actual.animal.yOffset).toBe(expected.animal.yOffset);
      for (const key of ['floorS', 'kneelS', 'raiseS', 'deadT']) expect(actual.mem[key]).toBe(expected.mem[key]);
      expect(Object.keys(actual.mem).filter(key=>key.startsWith('king'))).toEqual([]);
    }
});

test('species channels drive the original joints without writing actor memory', () => {
  const c = context();
  for (const name of ['neck1', 'neck2', 'jaw', 'tail', 'tail2', 'earL', 'earR', 'neck', 'wingL1', 'wingL2', 'wingR1', 'wingR2', 'legL', 'legR',
    ...['L', 'R'].flatMap(s => [`F${s}_shoulder`, `F${s}_carpus`, `B${s}_hip`, `B${s}_stifle`])]) c.bones[name] = new Bone();
  Object.assign(c.mem, { low: .8, snarl: .5, leap: .8, fold: .9, ground: .1, bank: .3, field: 1, rise: .5 });
  const retained = { ...c.mem };
  for (const key of ['canid', 'leopard', 'eagle', 'balbal'] as const) {
    const animate = numericCreaturePose(speciesRows.poses[key]);
    for (const bone of Object.values(c.bones)) { bone.position.set(0, 0, 0); bone.rotation.set(0, 0, 0); }
    c.attack = .48; animate(c);
    expect(transforms(c).every(Number.isFinite)).toBe(true);
    expect(transforms(c).some(value => Math.abs(value) > .01 && value !== 1)).toBe(true);
    expect(c.mem).toEqual(retained);
    if (key === 'canid') expect(c.bones['jaw']?.rotation.x).toBeGreaterThan(0);
    if (key === 'leopard') expect(c.bones['FR_shoulder']?.rotation.x).toBeLessThan(-.8);
    if (key === 'eagle') expect(c.bones['wingL1']?.rotation.y).toBeGreaterThan(1);
    if (key === 'balbal') expect(c.bones['armR_sh']?.rotation.x).toBeLessThan(-2);
  }
  c.alive = false; c.deathT = 1; numericCreaturePose(speciesRows.poses['canidDead'])(c);
  expect(c.bones['jaw']?.rotation.x).toBe(.25);
});

test('balbal decisions rise, strike once, return and sink on the bounded guest tick', () => {
  const scope=new Scope('balbal-pose');lendNalatiHeld(scope);
  const program = ReturnProgram.page(speciesRows.program,scope);
  const fields: Record<string, number> = { bearing: 0, homeBearing: 0, homeOff: 0, hitOff: 0, dt: .1, field: 1, px: 0, py: 0, pz: 2, x: 0, ay: 0, z: 0, yaw: 0,
    st: 0, t: 0, cd: 0, rise: 0, emerge: 1, hit: 0, gone: 0, slamT: 0, state: 0, init: 0,
    homeX: 0, homeZ: 0, homeYaw: 0, calm: 0, dawn: 0, emergeT: 1.6, attack: -1,
    bounds: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0, scale: 1.18, dmg: 30 };
  const tick = () => {
    const answer = program.project('think', fields);
    for (const key of ['st', 't', 'cd', 'rise', 'emerge', 'hit', 'gone', 'slamT', 'state', 'x', 'z']) {
      const value = answer[key]; if (value === undefined) throw new Error('Missing species channel'); fields[key] = value;
    }
    fields['init'] = 1; return answer;
  };
  for (let i = 0; i < 34; i++) tick();
  expect(fields['rise']).toBe(1); expect(fields['st']).toBe(1);
  tick(); expect(fields['st']).toBe(2);
  expect(tick()['start']).toBe(1); expect(fields['st']).toBe(3);
  fields['attack'] = .6; expect(tick()['strike']).toBe(1); expect(tick()['strike']).toBe(0);
  fields['attack'] = -1; expect(tick()['cancel']).toBe(1);
  fields['dawn'] = 1; tick(); expect(fields['st']).toBe(5);
  for (let i = 0; i < 31; i++) tick();
  expect(fields['gone']).toBe(1); expect(fields['rise']).toBe(0);
  const damage = (overrides: Record<string, number>) => {
    const { piercing = 0, ...observations } = overrides;
    return program.project('damage', { field: 1, rise: 1, open: 0, range: 0, crack: 0,
      requestPresent: 1, legacyTag: 0, equipmentMatch: 0, piercingTag: piercing, ...observations })['damage'];
  };
  expect(damage({ rise: .2 })).toBe(.25); expect(damage({ range: 5 })).toBe(.5);
  expect(damage({ piercing: 1, crack: 1, open: 1 })).toBe(3.125);scope.dispose();
});

test('packed species bodies lend owned indexed geometry for every family', () => {
  for (const look of nalatiSpeciesCatalogue().looks) {
    const row = nalatiSpeciesCatalogue().rows.find(candidate => candidate.kind === look.kind), variant = row?.variants[0], build = look.build;
    if (variant === undefined) throw new Error('Missing species variant');
    const first = build(variant, new Rng(1)), second = build(variant, new Rng(1));
    expect(first.bones.length).toBeGreaterThan(0);
    const parts = [...first.furParts, ...first.hardParts, ...first.eyeParts], copies = [...second.furParts, ...second.hardParts, ...second.eyeParts];
    expect(parts.length).toBeGreaterThan(0);
    for (const [i, part] of parts.entries()) {
      expect(part).not.toBe(copies[i]);
      const positions = part.getAttribute('position'); expect(positions.count).toBeGreaterThan(0);
      const indices = part.index; if (indices === null) throw new Error('Missing body indices');
      expect(Array.from(indices.array).every(index => index < positions.count)).toBe(true);
      part.dispose(); copies[i]?.dispose();
    }
  }
});
