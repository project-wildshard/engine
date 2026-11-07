import { EncounterSlotsSchema, SlotViewSchema } from '@wildshard/format/encounterRows';
import { afterEach, expect, test, vi } from 'vitest';
import { MeshBasicMaterial, Scene, Vector3 } from 'three';
import { lendLooks } from '../src/client/game/shardfile/lentLooks';
import * as v from 'valibot';
import { Scope } from '../src/shared/engine/app/scope';
import { app } from '../src/client/engine/app/runtime';
import type { Game } from '../src/client/engine/core/Game';
import { bindFlatTerrain } from '@wildshard/engine/test/terrain';
import { CueDirector } from '../src/client/game/audio/cueDirector';
import { SlotEncounterView } from '../src/client/game/boss/encounterView';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { NALATI_NIGHT as nightInput } from './fixtures/nalati-night';
import {withWeatherWitness} from './fixtures/weatherInlineWitness';

const night=withWeatherWitness(nightInput);

// Alternate-data fixture only: crowned guards, plinths, cues and wedge.
// This grants no second-shard credit to the native slot owner.
const slots = { ...v.parse(EncounterSlotsSchema,night.slots), actors: { kind: 'orchard-statue', variant: 'guard', variants: { '2': 'crowned' }, herd: -2, yaw: .5, sink: -1,
  memory: { rising: 0 }, home: { x: 'originX', z: 'originZ', yaw: 'facing' }, dawn: 'returning', gone: 'buried' } };
const cue = (id: string) => ({ id, vfx: [] });
const ids = ['cue.orchard.wake', 'cue.orchard.chip', 'cue.orchard.weak', 'cue.orchard.hard', 'cue.orchard.break', 'cue.orchard.stomp', 'cue.orchard.petal'];
const view = v.parse(SlotViewSchema, { cycle: { wake: 'spawn', dawn: 'dissolve' }, states: { broken: 'broken', retire: 'retire', home: 'statue' },
  cues: { wake: 'cue.orchard.wake', hit: 'cue.orchard.chip', weak: 'cue.orchard.weak', hard: { cue: 'cue.orchard.hard', drop: 20 }, broken: 'cue.orchard.break', strike: 'cue.orchard.stomp' },
  lift: { wake: 0.5, hit: 1, broken: 2, strike: 0 }, strike: { field: 'stompT', ahead: 0.5 }, every: 0.1,
  trails: [{ cue: 'cue.orchard.petal', field: 'rising', min: 0.2, max: 0.8, chance: 1, at: 'body', lift: 1 }],
  tell: { pool: 2, cone: 0.5, reach: 2, wind: 1, strike: 1.2, hold: 0.1, alpha: [0.5, 0.5, 2], look: 'orchard-tell' } });

function body(id: string, x: number, z: number, yaw: number, variant: string) {
  return { entityId: id, position: { x, y: 4, z }, yaw, variant, herd: 0, alive: true, hidden: false, scale: 2, yOffset: 0, hp: 100, attackPhase: -1, mem: {} as Record<string, number> };
}
type Body = ReturnType<typeof body>;

let restore = (): void => undefined;
afterEach(() => { restore(); vi.restoreAllMocks(); });

/** each pooled wedge's own look copy: the params it was given */
const copies: Map<string, unknown>[] = [];
function orchard(): { view: SlotEncounterView<Body>; heard: { id: string; at: number[] }[]; bodies: Body[]; retired:Body[]; scene: Scene; weak: { on: boolean } } {
  restore = bindFlatTerrain({ heightAt: () => 3 });
  const scope = new Scope('orchard'), scene = new Scene(), game = {} as Game;
  copies.length = 0;
  lendLooks(scope, { materials: new Map([['orchard-tell', new MeshBasicMaterial()]]), setParam: () => undefined, setTexture: () => undefined,
    bindMeshMap: () => new MeshBasicMaterial(), instance: () => { const params = new Map<string, unknown>(); copies.push(params); return { material: new MeshBasicMaterial(), setParam: (name, value) => { params.set(name, value); } }; } });
  Object.defineProperties(game, { levelScope: { value: scope }, app: { value: app }, scene: { value: scene } });
  const cues = new CueDirector(game, { version: 1, fields: [], rows: ids.map(cue) }), heard: { id: string; at: number[] }[] = [], bodies: Body[] = [], retired:Body[]=[], weak = { on: false };
  vi.spyOn(cues, 'cue').mockImplementation((id, at) => { heard.push({ id, at: at.toArray() }); });
  const sites = [{ x: 2, z: 5, yaw: 1, variant: 2 }, { x: 7, z: 9, yaw: 0, variant: 0 }];
  const guest=ReturnProgram.page(night.program);vi.spyOn(guest,'project').mockImplementation(()=>({weakPoint:Number(weak.on)}));
  const slotView = new SlotEncounterView<Body>(slots, view, ReturnProgram.page(night.program), { scene, cues, sites, guest });
  slotView.attachActors({ factory: { model: () => undefined }, spawn: (_kind, x, z, yaw, variant) => { const b = body(String(bodies.length), x, z, yaw, variant); bodies.push(b); return b; }, retire: a => { a.hidden = true; retired.push(a); } });
  return { view: slotView, heard, bodies, retired, scene, weak };
}

test('an orchard wakes its own sites with its own cues and hands their show and hide back as data', () => {
  const { view: slotView, heard, bodies } = orchard();
  expect(slotView.update(0.05, { kind: 1 })).toEqual([]);
  const woke = structuredClone(slotView.update(0.05, { kind: 1 }));
  expect(woke.length).toBeGreaterThan(0); expect(woke.every(change => change.awake === 1)).toBe(true);
  expect(heard.filter(row => row.id === 'cue.orchard.wake').map(row => row.at[1])).toEqual(woke.map(() => 3.5));
  expect(bodies[0]?.variant).toBeDefined();
  slotView.dawn(); expect(bodies.every(b => b.mem['returning'] === 1)).toBe(true);
});

test('hits, weak points, heavy blows, trails and the blow play their rows; the wedge shows through the wind-up', () => {
  const { view: slotView, heard, scene, weak } = orchard();
  slotView.wake([0]);
  const first = slotView.awake[0]?.a; if (first === undefined) throw new Error('Missing orchard guard');
  heard.length = 0;
  first.hp = 95; slotView.update(0.05, { kind: 1 });
  first.hp = 60; slotView.update(0.05, { kind: 1 });
  weak.on = true; first.hp = 55; slotView.update(0.05, { kind: 1 });
  // the cycle's own dusk wakes more guards on the way; only this guard's rows are counted (by where they play)
  const mine = () => heard.filter(row => row.id !== 'cue.orchard.wake' && Math.abs((row.at[0] ?? 0) - 2) < 3);
  expect(mine().map(row => row.id)).toEqual(['cue.orchard.chip', 'cue.orchard.hard', 'cue.orchard.weak']);
  expect(mine()[0]?.at).toEqual([2, 6, 5]);
  heard.length = 0; first.mem['rising'] = 0.5; slotView.update(0.11, { kind: 1 });
  expect(mine().map(row => row.id)).toEqual(['cue.orchard.petal']); expect(mine()[0]?.at[1]).toBe(6);
  heard.length = 0; first.mem['rising'] = 1; first.attackPhase = 0.5; slotView.update(0.05, { kind: 1 });
  const wedge = scene.children.find(child => child.visible && child.type === 'Mesh');
  expect(wedge).toBeDefined(); expect(mine()).toEqual([]);
  // one look copy per pooled wedge; the shown one alone took the wind-up's fill and alpha
  expect(copies).toHaveLength(2); expect(copies.filter(params => params.get('fill') === 0.5 && params.get('alpha') === 0.75)).toHaveLength(1);
  first.mem['stompT'] = 1; slotView.update(0.05, { kind: 1 });
  expect(mine().map(row => row.id)).toEqual(['cue.orchard.stomp']); expect(first.mem['stompT']).toBe(2);
  const at = new Vector3(...mine()[0]?.at ?? []);
  expect(at.distanceTo(new Vector3(2 + Math.sin(first.yaw) * 2, 3, 5 + Math.cos(first.yaw) * 2))).toBeLessThan(1e-9);
  first.attackPhase = -1; for (const other of slotView.awake) other.a.attackPhase = -1; slotView.update(0.05, { kind: 1 });
  expect(scene.children.filter(child => child.visible && child.type === 'Mesh')).toEqual([]);
});

test('a broken guard plays its rubble once and its plinth stands again when the roster releases it', () => {
  const { view: slotView, heard } = orchard();
  slotView.wake([1]);
  const guard = slotView.awake[0]?.a; if (guard === undefined) throw new Error('Missing orchard guard');
  heard.length = 0; guard.alive = false;
  slotView.update(0.1, { kind: 1 }); slotView.update(0.1, { kind: 1 });
  expect(heard.filter(row => row.id === 'cue.orchard.break')).toHaveLength(1);
  slotView.update(3.2, { kind: 1 }); expect(slotView.awake.some(row => row.a === guard)).toBe(false);
  expect(structuredClone(slotView.update(0.1, { kind: 0 }))).toContainEqual({ index: 1, awake: 0 });
});

test('view rows refuse unknown keys and a cue outside the cue namespace', () => {
  expect(() => v.parse(SlotViewSchema, { ...view, extra: 1 })).toThrow();
  expect(() => v.parse(SlotViewSchema, { ...view, cues: { ...view.cues, wake: 'wake' } })).toThrow();
});

test('one body roster rejects duplicate wakes and retires each returned actor once',()=>{
  const {view:slotView,bodies,retired}=orchard();
  slotView.wake([0,0,1]);slotView.wake([0]);expect(bodies).toHaveLength(2);
  const first=slotView.awake[0]?.a,second=slotView.awake[1]?.a;if(first===undefined||second===undefined)throw new Error('Missing guards');
  expect(first.variant).toBe('crowned');expect(first.yaw).toBe(1.5);expect(first.mem['originX']).toBe(2);expect(first.yOffset).toBe(-2);
  first.alive=false;slotView.update(.1,{kind:1});slotView.update(3.2,{kind:1});expect(retired.filter(a=>a===first)).toHaveLength(1);
  const dawn=structuredClone(slotView.update(.1,{kind:0}));expect(dawn).toContainEqual({index:0,awake:0});expect(second.mem['returning']).toBe(1);
  expect(slotView.update(.1,{kind:0})).not.toContainEqual({index:0,awake:0});
  second.mem['buried']=1;expect(structuredClone(slotView.update(.1,{kind:0}))).toContainEqual({index:1,awake:0});
  slotView.update(.1,{kind:0});expect(retired.filter(a=>a===second)).toHaveLength(1);
});

test('a corpse retiring after dawn restores its site on the next day step',()=>{
  const {view:slotView,retired}=orchard();slotView.wake([0]);
  const guard=slotView.awake[0]?.a;if(guard===undefined)throw new Error('Missing guard');
  slotView.update(.1,{kind:1});guard.alive=false;slotView.update(.1,{kind:0});
  expect(slotView.update(3.2,{kind:0})).not.toContainEqual({index:0,awake:0});
  expect(retired.filter(a=>a===guard)).toHaveLength(1);
  expect(structuredClone(slotView.update(.1,{kind:0}))).toContainEqual({index:0,awake:0});
  expect(slotView.update(.1,{kind:0})).not.toContainEqual({index:0,awake:0});
});
