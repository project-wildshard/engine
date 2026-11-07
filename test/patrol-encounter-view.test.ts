import { EncounterPatrolSchema, PatrolViewSchema, type EncounterPatrolRows } from '@wildshard/format/encounterRows';
import { afterEach, expect, test, vi } from 'vitest';
import { Bone, BoxGeometry, BufferGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Skeleton, SkinnedMesh, Vector3, type Vector2 } from 'three';
import * as v from 'valibot';
import { Scope } from '../src/shared/engine/app/scope';
import { app } from '../src/client/engine/app/runtime';
import type { Game } from '../src/client/engine/core/Game';
import type { Player } from '../src/client/engine/player/Player';
import type { Forest } from '../src/client/engine/world/forest/Forest';
import type { SkyRig } from '../src/client/engine/world/skyRig';
import { bindFlatTerrain } from '@wildshard/engine/test/terrain';
import { CueDirector } from '../src/client/game/audio/cueDirector';
import { lendLooks } from '../src/client/game/shardfile/lentLooks';
import { PatrolEncounterView } from '../src/client/game/boss/encounterView';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { Rng } from '../src/shared/engine/core/rng';
import { NALATI_NIGHT as nightInput } from './fixtures/nalati-night';
import {withWeatherWitness} from './fixtures/weatherInlineWitness';

const night=withWeatherWitness(nightInput);

// Alternate-data fixture only: lantern wraiths, a warden and declared looks/cues.
// This grants no second-shard credit to the native patrol adapter.
const view = v.parse(PatrolViewSchema, { looks: { scout: 'orchard-scout', warden: 'orchard-warden', hush: 'orchard-hush' }, quietLook: 'hush', quietScale: 2,
  figure: { bone: 'saddle' }, seat: [0, 1, 0], states: { fade: 'fade', dying: 'dying', dead: 'dead' },
  cues: { form: 'cue.orchard.form', tear: 'cue.orchard.tear', loose: 'cue.orchard.loose', hurt: 'cue.orchard.hurt', impact: 'cue.orchard.impact' },
  lift: { form: 0.5, loose: 0.2 }, trail: { cue: 'cue.orchard.trail', rate: 0, back: 1 }, aim: 'aim', damage: 7,
  targets: [{ at: [0, 1.5, 0], radius: 0.3, head: true }],
  arrow: { geometry: { data: new BufferGeometry().copy(new BoxGeometry(0.02, 0.02, 0.5)).toJSON().data }, colour: [1, 0.8, 0.3], renderOrder: 9, length: 0.5, gravity: 4, drag: 0, windCoupling: 0, bury: 0, recover: 0,
    maxFlying: 4, maxStuck: 0, stick: false, hitsAnimals: false, puffs: false, hurtsPlayer: { radius: 0.4, height: 1.8 } } });
const patrol = { ...v.parse(EncounterPatrolSchema,night.patrol), actors: { kind: 'orchard-watch', variant: 'scout', leader: 'warden', count: 2, herd: -2,
  player: { x: 'px', z: 'pz' }, target: { x: 'tx', z: 'tz' }, steering: { tx: 'tx', tz: 'tz', v: 'v', turn: 'turn' } } };
const ids = ['form', 'tear', 'loose', 'hurt', 'impact', 'trail'].map(id => `cue.orchard.${id}`);

function body(id: string, x: number, z: number, yaw: number, variant: string) {
  const saddle = new Bone(); saddle.name = 'saddle';
  const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial()); mesh.add(saddle); mesh.bind(new Skeleton([saddle]));
  return { entityId: id, kind: 'orchard-watch', position: new Vector3(x, 0, z), yaw, variant, herd: 0, alive: true, hidden: false, scale: 1, mesh,
    mem: {} as Record<string, number>, applyDamage: () => false, damageFor: () => 0 };
}
type Body = ReturnType<typeof body>;

let restore = (): void => undefined;
afterEach(() => { restore(); vi.restoreAllMocks(); });

function orchard(input:EncounterPatrolRows=patrol) {
  restore = bindFlatTerrain({ heightAt: () => 2 });
  const scope = new Scope('orchard-watch'), scene = new Scene(), game = {} as Game;
  // the watch's looks lend one copy per rider material (each with its own fade)
  lendLooks(scope, { materials: new Map(['orchard-scout', 'orchard-warden', 'orchard-hush'].map(id => [id, new MeshBasicMaterial()])), setParam: () => undefined,
    setTexture: () => undefined, bindMeshMap: () => new MeshBasicMaterial(), instance: () => ({ material: new MeshBasicMaterial(), setParam: () => undefined }) });
  Object.defineProperties(game, { levelScope: { value: scope }, app: { value: app }, scene: { value: scene }, camera: { value: new PerspectiveCamera(60) },
    renderer: { value: { getDrawingBufferSize: (out: Vector2) => out.set(800, 600) } } });
  const player = { position: new Vector3(0, 2, 30) } as Player, cues = new CueDirector(game, { version: 1, fields: [], rows: ids.map(id => ({ id, vfx: [] })) });
  const heard: { id: string; at: number[] }[] = [];
  vi.spyOn(cues, 'cue').mockImplementation((id, at) => { heard.push({ id, at: at.toArray() }); });
  const figure = new BoxGeometry(0.4, 1, 0.4), bodies: Body[] = [];
  const program=ReturnProgram.page(night.program);
  const watch = new PatrolEncounterView<Body>({ patrol:input, motion: night.motion, view }, program,
    { game, sky: {} as SkyRig, player, forest: {} as Forest, cues, figures: { scout: figure, warden: figure, hush: figure } });
  watch.attachActors({ factory: { model: () => undefined }, spawn: (_kind, x, z, yaw, variant) => { const b = body(String(bodies.length), x, z, yaw, variant); bodies.push(b); return b; }, retire: a => { a.hidden = true; } });
  return { watch, heard, bodies, scene, player, scope, program };
}

test('an orchard watch forms its own line in its own looks and figures, and a quiet one grows', () => {
  const { watch, heard } = orchard();
  const line = watch.spawnLine({ captain: true, at: 0 });
  expect(line.map(a => a.variant)).toEqual(['warden', 'scout']);
  for (const a of line) {
    expect(a.mesh.material).toHaveProperty('name', `orchard-${a.variant}`);
    const figure = a.mesh.skeleton.getBoneByName('saddle')?.children[0];
    expect(figure).toBeInstanceOf(Mesh); expect(figure?.name).toBe(`orchard-${a.variant}-figure`);
    a.mesh.castShadow = true; expect(a.mesh.castShadow).toBe(false);
  }
  expect(heard.filter(row => row.id === 'cue.orchard.form').map(row => row.at[1])).toEqual([2.5, 2.5]);
  const quiet = watch.spawnRider({ x: 5, z: 6, yaw: 0, quiet: true });
  expect(quiet?.scale).toBe(2); expect(quiet?.mesh.material).toHaveProperty('name', 'orchard-hush');
});

test('its targets meet a ray first; its arrows hand their hits back as data and play its cues', () => {
  const { watch, heard, player } = orchard();
  const a = watch.spawnRider({ x: 0, z: 0, yaw: 0 }); if (a === null) throw new Error('Missing watch');
  a.mesh.updateMatrixWorld(true);
  const hit = watch.target(new Vector3(0, 1.5, -10), new Vector3(0, 0, 1), 50, null);
  expect(hit?.animal).toBe(a); expect(hit?.headshot).toBe(true); expect(hit?.distance).toBeCloseTo(9.7, 5);
  expect(watch.target(new Vector3(0, 1.5, -10), new Vector3(0, 0, 1), 50, { animal: a, point: new Vector3(), distance: 3, headshot: false })?.distance).toBe(3);
  heard.length = 0;
  vi.spyOn(watch.arrows, 'update').mockImplementation(() => { watch.arrows.onPlayerHit?.(player.position, new Vector3(0, 0, 1)); });
  const hits = watch.update(0.05, 1, { hold: 1, night: 1 });
  expect(hits).toEqual([{ damage: 7, from: null }]); expect(heard.map(row => row.id)).toContain('cue.orchard.hurt');
  expect(watch.update(0.05, 1.05, { hold: 1, night: 1 }).length).toBe(1);
  vi.restoreAllMocks(); expect(watch.update(0.05, 1.1, { hold: 1, night: 1 })).toEqual([]);
});

test('the member\'s fade drives its looks, and a dying one tears into its own mist until it retires', () => {
  const { watch, heard } = orchard();
  const a = watch.spawnRider({ x: 0, z: 0, yaw: 0 }); if (a === null) throw new Error('Missing watch');
  const rider = watch.riders[0]; if (rider === undefined) throw new Error('Missing rider');
  rider.law.state['fade'] = 0.4; watch.update(0.05, 0, { hold: 1, night: 1 });
  expect(rider.view.fades.map(fade => fade.value)).toEqual([0.4, 0.4]);
  heard.length = 0; watch.dissolve(a); expect(rider.law.state['dying']).toBeGreaterThan(0);
  watch.update(0.05, 0.05, { hold: 1, night: 1 });
  expect(heard.some(row => row.id === 'cue.orchard.tear')).toBe(true);
  for (let i = 0; i < 80 && watch.riders.length > 0; i++) watch.update(0.1, i * 0.1, { hold: 1, night: 1 });
  expect(watch.riders).toEqual([]); expect(a.hidden).toBe(true);
});

test('on the wire a page draws a gallop behind a body that is up, and tears only what the server says', () => {
  const { watch, heard } = orchard(), up = body('row-up', 0, 0, 0, 'scout'), down = body('row-down', 9, 0, 0, 'scout');
  down.alive = false;
  const rows = [{ ...up, rowDriven: true }, { ...down, rowDriven: true }];
  vi.spyOn(app.rng, 'stream').mockReturnValue({ next: () => -1 } as ReturnType<typeof app.rng.stream>); // under any rate, this fixture's 0 too
  watch.showRows('orchard-watch', rows, 0.05, { cue: (id, at) => { heard.push({ id, at: at.toArray() }); } });
  watch.showRows('orchard-watch', rows, 0.05, { cue: (id, at) => { heard.push({ id, at: at.toArray() }); } });
  expect(heard.filter(row => row.id === 'cue.orchard.form')).toHaveLength(2);
  expect(heard.filter(row => row.id === 'cue.orchard.trail')).toHaveLength(2);
  expect(heard.some(row => row.id === 'cue.orchard.tear')).toBe(false);
  watch.hearTear([1, 2, 3], { cue: (id, at) => { heard.push({ id, at: at.toArray() }); } });
  expect(heard.at(-1)).toEqual({ id: 'cue.orchard.tear', at: [1, 2, 3] });
});

test('view rows refuse a look without its figure', () => {
  const { scope } = orchard(), game = {} as Game;
  Object.defineProperties(game, { levelScope: { value: scope }, app: { value: app }, scene: { value: new Scene() } });
  expect(() => new PatrolEncounterView<Body>({ patrol, motion: night.motion, view }, ReturnProgram.page(night.program),
    { game, sky: {} as SkyRig, player: { position: new Vector3() } as Player, forest: {} as Forest, cues: {} as CueDirector, figures: {} })).toThrow('figure');
});

test('the real native roster admits once, holds, dissolves at dawn and resets next night',()=>{
  const {watch,heard,scope}=orchard();
  try{
    for(let i=0;i<8;i++)watch.update(.1,i*.1,{hold:0,night:1});
    expect(watch.riders).toHaveLength(2);expect(heard.filter(row=>row.id==='cue.orchard.form')).toHaveLength(2);
    const victim=watch.riders[0]?.a;if(victim===undefined)throw new Error('Missing watch');victim.alive=false;
    for(let i=0;i<15;i++)watch.update(.1,1+i*.1,{hold:1,night:1});
    expect(watch.killsTonight).toBe(1);expect(victim.hidden).toBe(true);expect(watch.riders.some(r=>r.a===victim)).toBe(false);
    watch.update(.1,3,{hold:0,night:0});expect(watch.killsTonight).toBe(1);
    for(let i=0;i<25;i++)watch.update(.1,4+i*.1,{hold:0,night:0});
    expect(watch.riders).toEqual([]);expect(watch.killsTonight).toBe(1);
    for(let i=0;i<40;i++)watch.update(.1,7+i*.1,{hold:1,night:1});
    expect(watch.riders).toEqual([]);expect(watch.killsTonight).toBe(0);
    watch.update(.1,12,{hold:0,night:0});
    for(let i=0;i<25;i++)watch.update(.1,13+i*.1,{hold:0,night:1});
    expect(watch.riders).toHaveLength(2);
  }finally{scope.dispose();}
});

test('borrowed route and memory rows keep native steering and freeze independent of drawing',()=>{
  const input={...patrol,parameters:{...patrol.parameters,center:-40,x0:18,x1:16,x2:12,x3:7,z1:4,z2:8,z3:12,z4:16,d1:5,d2:10,d3:15,d4:20,canter:2},
    actors:{...patrol.actors,player:{x:'seenX',z:'seenZ'},target:{x:'goalX',z:'goalZ'},steering:{goalX:'tx',goalZ:'tz',speed:'v'}}};
  const {watch,player,scope}=orchard(input);
  try{
    player.position.set(200,0,-40);const line=watch.spawnLine({captain:true,at:0});
    expect(line.map(a=>a.variant)).toEqual(['warden','scout']);const first=line[0];if(first===undefined)throw new Error('Missing watch');
    watch.update(.1,1,{hold:1,night:1});expect(first.herd).toBe(-2);expect(first.mem['seenX']).toBe(200);expect(first.mem['speed']).toBe(2);
    watch.update(.05,1.05,{hold:1,night:1},true);expect(first.mem['goalX']).toBe(first.position.x);expect(first.mem['goalZ']).toBe(first.position.z);
    expect(()=>watch.spawnLine({count:9})).toThrow('group size');
  }finally{scope.dispose();}
});

test('forming a native line preserves borrowed AI draw order and each first firing clock',()=>{
  const stream=app.rng.stream('ai'),before=stream.snapshot(),oracle=new Rng(0);oracle.restore(before);
  const {watch,player,scope}=orchard(),program=ReturnProgram.page(night.program);
  try{
    program.project(patrol.signals.start,{...patrol.parameters,at:0,px:player.position.x,pz:player.position.z},oracle);
    const expected=Array.from({length:patrol.actors.count},()=>program.project(patrol.signals.retry,{first:1},oracle)['fireT']);
    watch.spawnLine({at:0});expect(watch.riders.map(r=>r.law.state['fireT'])).toEqual(expected);expect(stream.snapshot()).toEqual(oracle.snapshot());
  }finally{scope.dispose();stream.restore(before);}
});

test('actual firing borrows ten-Hz player motion and rejects teleport samples',()=>{
  const {watch,player,scope,program}=orchard(),project=vi.spyOn(program,'project');
  try{
    const actor=watch.spawnRider({x:0,z:0,yaw:0}),rider=watch.riders[0];
    if(actor===null||rider===undefined)throw new Error('Missing watch');
    const fire=(dt:number)=>{
      rider.law.set({fireT:0,fade:1});project.mockClear();watch.update(dt,1,{hold:1,night:1});
      return project.mock.calls.find(([signal])=>signal===view.aim)?.[1];
    };
    expect(fire(.1)?.['vx']).toBe(0);player.position.x=1;
    expect(fire(.1)?.['vx']).toBe(10);expect(fire(.05)).toBeUndefined();
    player.position.x=100;player.position.z=0;actor.position.x=100;
    // A nearby shot after teleport still receives a rejected velocity sample.
    actor.position.z=-30;expect(fire(.1)?.['vx']).toBe(0);expect(fire(.1)?.['vz']).toBe(0);
  }finally{scope.dispose();}
});
