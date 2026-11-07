// oxlint-disable-next-line import/no-nodejs-modules -- The actual host consumes the shipped native physics bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test, vi } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { compileScript } from '@wildshard/sharddev/compileScript';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { buildDecisionRegistries } from '@wildshard/format/decisionBindings';
import { parseActorMoves } from '@wildshard/format/actorMoves';
import { scriptV1Layout } from '@wildshard/format/scriptAbiV1';
import { createShardfileSim, bindShardfileSim, prepareShardfileSimRestore, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { DecisionModule } from '../src/shared/engine/script/decisionModule';
import { createSimHost, type SimSpawn } from '../src/server/engine/sim';
import { borrowedDecisionAuthority } from '../src/server/game/shardfile/borrowedDecisions';
import { ShardDecisions, type DecisionRuntime } from '../src/server/game/shardfile/decisions';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import * as v from 'valibot';
import { ClientChannels } from '../src/sharddev/clientChannels';
import { SaveStore } from '../src/shared/engine/saves/store';
import { GridRegionDurability } from '../src/server/game/grid/durability';
import { FIXTURE_RUNTIME_COST } from './fixtures/clientPlanRuntime';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
const io = scriptV1Layout(1, 0), state = 16384 + io.state * 8, out = 16384 + io.outbox * 8;
let bytes: Uint8Array = new Uint8Array(), refused: Uint8Array = new Uint8Array();
function command(at: number, op: number, target: number, a: number, b: number): string {
  return [op, target, a, b, 0].map((value, slot) => `store<f64>(${out + (at * 5 + slot) * 8},${value});`).join('');
}
function module(body: string) { return compileScript(`@external("env","ws_list") declare function list(op:i32,a:f64,b:f64,out:i32,cap:i32):i32; export function ws_abi():i32{return 1;} export function ws_init(lo:i32,hi:i32):void{} export function ws_io():i32{return 16384;} export function ws_handle():i32 { if(load<f64>(${state})>0)return 0;store<f64>(${state},1);${body}}`, { abi: 1 }); }
beforeAll(async () => {
  bytes = await module(`${command(0, 1, 1, 1, 2)}${command(1, 2, 1, 1, 2)}${command(2, 4, 1, 89, 1)}${command(3, 7, 0, 1, 1)}return 4;`);
  refused = await module(`${command(0, 1, 1, 1, 2)}${command(1, 4, 1, 89, 99)}return 2;`);
});
function fixture(wasm = bytes, binding?: { shard: true } | { encounter: string }) {
  const source = emptyShardfile({ slug: 'decision-sim', name: 'Decision Sim', author: 'Test', seed: 2, revision: 1 });
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing creature fixture');
  source.rows.species = [{ id: 'boar', kind: 'boar', label: 'Boar', aggressive: false, lockable: true, dims: structuredClone(native.spec.dims),
    variants: [{ id: 'boar', label: 'Boar', rarity: 'common', weight: 1, scale: [1, 1], hp: 100, mods: structuredClone(native.spec.mods) }] }];
  source.rows.strikes = [{ id: 'bump', shape: { kind: 'sphere', radius: 3 }, windup: 0.02, active: 0.05, recover: 0.02, cooldown: 0.02, range: 3, damage: 7, tags: ['dmg.melee'], weight: 1, speed: 0 }];
  source.creatures.spawns = ['actor.a', 'actor.b'].map((id, index) => ({ id, species: 'boar', variant: 'boar', brain: null, strike: null, seed: index + 1, scale: 1, at: [0, 0, 5 + index * 2], yaw: 0 }));
  source.encounters = ['actor.a', 'actor.b'].map((entity, index) => ({ id: `encounter.${index}`, entity, kind: 'boss', panel: null, name: entity, title: 'Test', retry: 'Retry', arena: { at: [0, 0, 6], radius: 20 }, intro: 0, introShort: 0, respawn: { at: [0, 0, 0], yaw: 0 }, phases: [{ at: 1, name: 'Fight', caption: 'Fight', speed: 0, stopDistance: 0, turnRate: 2 }] }));
  source.state.shared = [{ id: 89, name: 'phase', type: 'i32', privacy: 'public', default: 0, min: 0, max: 3 }];
  source.quests.flags = ['done'];
  const moves = parseActorMoves([{ id: 'approach', kind: 'stalk', speed: 1, turn: 2, ground: true, altitude: 0, standOff: 0, ready: { kind: 'band', tolerance: 0.05 } }]);
  const hash = hashImmutableBytes(wasm), scripts = parseDecisionScripts([{ id: 'controller', abi: '1.0', side: 'sim', module: `blobs/wasm/${hash}.wasm`, source: 'behaviour/controller.as', binding: binding ?? { shard: true }, onFail: 'hold',
    on: ['start', 'move.done', 'strike.done', 'hit', 'death'], reads: [], commands: ['move', 'strike', 'field', 'flag'], stateVersion: 1, state: [{ name: 'calls', type: 'i32', default: 0, scope: 'binding' }], params: {},
    actors: { a: 'actor.a', b: 'actor.b' }, moves: { approach: 'approach' }, strikes: { bump: 'bump' }, fields: { phase: 'phase' }, flags: { done: 'done' } }]);
  const sections = new Map<string, unknown>([['sim/scripts', scripts], ['actors/moves', moves]]), assets = new Map([[hash, wasm]]);
  return { source, assets, sections, scripts, options: { sections } };
}

test('region observations retain ordered enter/leave events and exact continuation membership', async () => {
  const f = fixture(await module('return 0;')), row = f.scripts[0];
  if (row === undefined) throw new Error('Missing zone decision');
  row.on = ['start', 'zone.enter', 'zone.leave'];
  f.source.quests.flags.push('hut');
  f.source.quests.triggers = [{ id: 'hut', kind: 'region', flag: 'hut', x: 0, z: 6, radius: 2 }];
  const live = createShardfileSim(f.source, f.assets, { ...f.options, rapier: await rapier });
  const decision = live.decisions;
  if (decision === undefined) throw new Error('Missing native decision');
  const zone = decision.registries.zones?.get('hut'), a = decision.registries.actors?.get('actor.a'), b = decision.registries.actors?.get('actor.b');
  if (zone === undefined || a === undefined || b === undefined) throw new Error('Missing original zone handles');
  const enqueue = vi.spyOn(decision.host, 'enqueue');
  const events = (): unknown[] => enqueue.mock.calls.filter(([, event]) => event[0] === 4 || event[0] === 5);
  try {
    live.host.step();
    expect(events()).toEqual([[1, [4, zone, a, 0, 0, 0]], [1, [4, zone, b, 0, 0, 0]]]);
    enqueue.mockClear(); live.host.step(); expect(events()).toEqual([]);
    const saved = decision.snapshot(); decision.restore(saved);
    expect(decision.snapshot()).toBe(saved);
    enqueue.mockClear(); live.host.step(); expect(events()).toEqual([]);
    const actor = live.host.entities.get('actor.a'); if (actor === undefined) throw new Error('Missing native zone actor');
    actor.place(20, 20, 0);
    enqueue.mockClear(); live.host.step(); expect(events()).toEqual([[1, [5, zone, a, 0, 0, 0]]]);
    enqueue.mockClear(); live.host.step(); expect(events()).toEqual([]);
  } finally { enqueue.mockRestore(); live.dispose(); }
});

test('region key reuse preserves renamed trigger order and exact silent continuation', async () => {
  const f = fixture(await module('return 0;')), row = f.scripts[0];
  if (row === undefined) throw new Error('Missing native region decision');
  row.on = ['start', 'zone.enter', 'zone.leave'];
  f.source.quests.flags.push('hut', 'meadow');
  const hut = { id: 'hut', kind: 'region' as const, flag: 'hut', x: 0, z: 6, radius: 2 };
  const meadow = { id: 'meadow', kind: 'region' as const, flag: 'meadow', x: 50, z: 6, radius: 2 };
  f.source.quests.triggers = [hut, meadow];
  const live = createShardfileSim(f.source, f.assets, { ...f.options, rapier: await rapier }), decision = live.decisions;
  if (decision === undefined) throw new Error('Missing actual native observation owner');
  const a = decision.registries.actors?.get('actor.a'), b = decision.registries.actors?.get('actor.b');
  const h = decision.registries.zones?.get('hut'), m = decision.registries.zones?.get('meadow');
  if (a === undefined || b === undefined || h === undefined || m === undefined) throw new Error('Missing admitted native handles');
  const enqueue = vi.spyOn(decision.host, 'enqueue');
  const events = (): unknown[] => enqueue.mock.calls.filter(([, event]) => event[0] === 4 || event[0] === 5);
  const swapped = [[1, [4, m, a, 0, 0, 0]], [1, [4, m, b, 0, 0, 0]],
    [1, [5, h, a, 0, 0, 0]], [1, [5, h, b, 0, 0, 0]]];
  try {
    live.host.step();
    expect(events()).toEqual([[1, [4, h, a, 0, 0, 0]], [1, [4, h, b, 0, 0, 0]]]);
    enqueue.mockClear();
    live.host.step(); expect(events()).toEqual([]);
    // Authored rows may change in place: cache identity cannot freeze their id,
    // observation position, native registry selection or publication ordering.
    hut.id = 'meadow'; meadow.id = 'hut';
    live.host.step(); expect(events()).toEqual(swapped);
    const saved = decision.snapshot(); enqueue.mockClear(); decision.restore(saved);
    expect(decision.snapshot()).toBe(saved); expect(enqueue).not.toHaveBeenCalled();
    live.host.step(); expect(events()).toEqual([]);
    enqueue.mockClear();
    f.source.quests.triggers.reverse(); live.host.step(); expect(events()).toEqual([]);
    const actor = live.host.entities.get('actor.a'); if (actor === undefined) throw new Error('Missing real region body');
    actor.place(50, 6, 0); live.host.step();
    expect(events()).toEqual([[1, [4, h, a, 0, 0, 0]], [1, [5, m, a, 0, 0, 0]]]);
  } finally { enqueue.mockRestore(); live.dispose(); }
});

test('achievement display rows preserve a pre-catalogue decision continuation silently', async () => {
  const f = fixture(), first = createShardfileSim(f.source, f.assets, { ...f.options, rapier: await rapier });
  let restored: ShardfileSimulation | undefined;
  try {
    for (let i = 0; i < 9; i++) first.host.step();
    const saved = first.decisions?.snapshot();
    if (saved === undefined) throw new Error('Missing pre-catalogue decision owner');
    f.source.quests.achievements = [{ id: 'traveller', name: 'Traveller', goal: 'Find the crossing', count: 1,
      event: 'crossing', title: 'Across the water', icon: 'poi' }];
    restored = createShardfileSim(f.source, f.assets, { ...f.options, rapier: await rapier });
    const invoke = vi.spyOn(DecisionModule.prototype, 'invoke');
    try {
      restored.decisions?.restore(saved);
      expect(restored.decisions?.snapshot()).toBe(saved);
      expect(invoke).not.toHaveBeenCalled();
    } finally { invoke.mockRestore(); }
  } finally { restored?.dispose(); first.dispose(); }
});

test('source provenance preserves native continuation while executable row changes still refuse', async () => {
  const f = fixture(), row = f.scripts[0], R = await rapier;
  if (row === undefined) throw new Error('Missing script fixture');
  const first = createShardfileSim(f.source, f.assets, { ...f.options, rapier: R });
  try {
    for (let i = 0; i < 9; i++) first.host.step();
    for (const sourceHash of ['a'.repeat(64), 'b'.repeat(64), undefined]) {
      if (sourceHash === undefined) delete row.sourceHash; else row.sourceHash = sourceHash;
      const saved = snapshotSimHost(first.host), invoke = vi.spyOn(DecisionModule.prototype, 'invoke');
      let resumed: ShardfileSimulation | undefined;
      try {
        const restored = restoreSimHost(first.host.level, { rapier: R }, saved, host => {
          resumed = bindShardfileSim(host, f.source, f.assets, { ...f.options, rapier: R, restoring: true });
          // Fresh-host initialization precedes adapter restore; observe only the restore itself.
          invoke.mockClear();
        });
        expect(invoke).not.toHaveBeenCalled(); expect(snapshotSimHost(restored)).toEqual(saved);
        for (let i = 0; i < 30; i++) { first.host.step(); restored.step(); }
        expect(snapshotSimHost(restored)).toEqual(snapshotSimHost(first.host));
      } finally { invoke.mockRestore(); resumed?.dispose(); }
    }
    const saved = first.decisions?.snapshot(); if (saved === undefined) throw new Error('Missing continuation');
    const changedModule = `blobs/wasm/${hashImmutableBytes(refused)}.wasm`; f.assets.set(hashImmutableBytes(refused), refused);
    for (const change of [{ module: changedModule }, { params: { changed: 1 } }, { stateVersion: 2 }, { onFail: 'reset' as const }]) {
      f.sections.set('sim/scripts', [{ ...row, ...change }]);
      const incompatible = createShardfileSim(f.source, f.assets, { ...f.options, rapier: R });
      try {
        const before = snapshotSimHost(incompatible.host);
        expect(() => incompatible.decisions?.restore(saved)).toThrow('Incompatible decision continuation');
        expect(snapshotSimHost(incompatible.host)).toEqual(before);
      } finally { incompatible.dispose(); }
    }
  } finally { first.dispose(); }
});

test('two actors execute rows on the real fixed-step move, strike, field and flag owners', async () => {
  const f = fixture(), sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: await rapier });
  try {
    for (let i = 0; i < 6; i++) sim.host.step();
    expect(sim.decisions?.host.state(1)).toEqual({ calls: 0 }); expect(sim.host.flags.has('done')).toBe(false);
    sim.host.step(); expect(sim.decisions?.host.state(1)).toEqual({ calls: 1 }); expect(sim.host.flags.has('done')).toBe(true);
    expect(sim.decisions?.publication().fields).toContainEqual({ actor: 1, field: 89, value: 1 });
    expect(sim.decisions?.publication().events.map(row => row.kind)).toEqual(['move', 'strike']);
    for (let i = 0; i < 30; i++) sim.host.step();
    expect(sim.host.entities.get('actor.b')?.hp).toBe(93);
    expect(sim.host.entities.get('actor.a')?.position.z).toBeGreaterThan(5);
    expect(sim.decisions?.host.metrics()[0]?.refusals).toBe(0);
  } finally { sim.dispose(); }
});

test('spawnGroupAlive counts the whole declared pack across death and return', async () => {
  const f = fixture(), row = f.scripts[0]; if (row === undefined) throw new Error('Missing group fixture');
  row.binding = { spawnGroup: 'test.pack' }; row.on = ['start', 'tick']; row.tick = 10; row.commands = []; row.reads = ['spawnGroupAlive'];
  row.spawns = { pack: 'test.pack' }; row.state = [{ name: 'calls', type: 'i32', default: 0, scope: 'actor' }];
  const group = buildDecisionRegistries(f.source, [], undefined, [], f.scripts).spawns?.get('test.pack');
  if (group === undefined) throw new Error('Missing declared group handle');
  const wasm = await compileScript(`@external("env","ws_read") declare function read(op:i32,a:f64,b:f64):f64;
    export function ws_abi():i32{return 1;} export function ws_init(lo:i32,hi:i32):void{}
    export function ws_io():i32{return 16384;} export function ws_handle():i32{store<f64>(${state},read(18,${group},0));return 0;}`, { abi: 1 });
  const hash = hashImmutableBytes(wasm); row.module = `blobs/wasm/${hash}.wasm`; f.assets.clear(); f.assets.set(hash, wasm);
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing native body');
  const recipes: SimSpawn[] = [];
  for (const [index, id] of ['actor.a', 'actor.b'].entries()) recipes.push({ ...native, id, at: { x: 0, y: 0, z: 5 + index * 2 } });
  f.source.creatures.spawns = []; f.source.encounters = [];
  f.source.runtime = { kind: 'client-plan', cost: FIXTURE_RUNTIME_COST, binds: ['spawns'], spawns: { bosses: [], homes: recipes.map(recipe => ({
    id: recipe.id, kind: native.spec.kind, look: 'boar', at: [recipe.at.x, recipe.at.z], yaw: recipe.yaw, respawn: 1,
  })) } };
  const owner = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier: await rapier });
  for (const recipe of recipes) owner.spawn(recipe);
  const runtime: DecisionRuntime = { scope: owner.scope, events: owner.events, flags: owner.flags, get physics() { return owner.physics; },
    player: leadPlayer(owner), state: owner.state, slots: owner.slots, entities: owner.entities, strikes: owner.strikes,
    borrowedActors: new Set(recipes.map(recipe => recipe.id)), groundHeightAt: (x, z) => owner.groundHeightAt(x, z),
    registerStrikeCatalogue: (id, strikes) => { owner.registerStrikeCatalogue(id, strikes); },
    startDeclaredStrike: (actor, target, strike) => owner.startDeclaredStrike(actor, target, strike),
    onStep: (id, run, adapter, phase) => owner.onStep(id, run, adapter, phase),
  };
  const sim = { host: owner, decisions: new ShardDecisions(runtime, f.source, f.assets, f.sections, new Map(), undefined), dispose: () => { owner.dispose(); } };
  try {
    const member = sim.host.entities.get('actor.b'); if (member === undefined) throw new Error('Missing member');
    for (let i = 0; i < 7; i++) sim.host.step();
    expect(sim.decisions.host.state(1)).toEqual({ calls: 2 }); expect(sim.decisions.host.state(2)).toEqual({ calls: 2 });
    member.applyFinalDamage(1_000_000, member.position, member.position);
    for (let i = 0; i < 6; i++) sim.host.step();
    expect(sim.decisions.host.state(1)).toEqual({ calls: 1 });
    const recipe = recipes.find(actor => actor.id === 'actor.b'); if (recipe === undefined) throw new Error('Missing spawn recipe');
    expect(sim.host.retire('actor.b')).toBe(true);
    for (let i = 0; i < 6; i++) sim.host.step();
    expect(sim.decisions.host.state(1)).toEqual({ calls: 1 });
    sim.host.spawn(recipe);
    for (let i = 0; i < 6; i++) sim.host.step();
    expect(sim.decisions.host.state(1)).toEqual({ calls: 2 });
    expect(sim.decisions.host.metrics().every(metric => metric.refusals === 0)).toBe(true);
  } finally { sim.dispose(); }
});

test('a guest relocates its retained body once from admitted fields without replay on restore', async () => {
  const wasm = await module(`${command(0, 1, 1, 1, 2)}return 1;`), f = fixture(wasm), R = await rapier;
  f.source.state.shared.push(
    { id: 90, name: 'relocate.x', type: 'f64', privacy: 'public', default: 12, min: -100, max: 100 },
    { id: 91, name: 'relocate.z', type: 'f64', privacy: 'public', default: 16, min: -100, max: 100 });
  f.sections.set('actors/moves', parseActorMoves([{ id: 'approach', kind: 'relocate', point: { kind: 'fields', x: 'relocate.x', z: 'relocate.z' }, facing: 'target' }]));
  const sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: R });
  let resumed: ShardfileSimulation | undefined;
  try {
    const body = sim.host.entities.get('actor.a'); if (body === undefined) throw new Error('Missing retained body');
    const place = vi.spyOn(body, 'place');
    for (let i = 0; i < 12; i++) sim.host.step();
    expect(sim.host.entities.get('actor.a')).toBe(body);
    expect([body.position.x, body.position.z]).toEqual([12, 16]);
    expect(place).toHaveBeenCalledTimes(1); expect(sim.decisions?.host.metrics()[0]?.refusals).toBe(0);
    const saved = snapshotSimHost(sim.host);
    const restored = restoreSimHost(sim.host.level, { rapier: R }, saved, host => { resumed = bindShardfileSim(host, f.source, f.assets, { ...f.options, rapier: R, restoring: true }); });
    const next = restored.entities.get('actor.a'); if (next === undefined) throw new Error('Missing restored body');
    const replay = vi.spyOn(next, 'place');
    for (let i = 0; i < 30; i++) { sim.host.step(); restored.step(); }
    expect(replay).not.toHaveBeenCalled(); expect(snapshotSimHost(restored)).toEqual(snapshotSimHost(sim.host));
  } finally { sim.dispose(); resumed?.dispose(); }
});

test('a bad last command refuses motion and world fields together with proposed script state', async () => {
  const f = fixture(refused), sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: await rapier });
  try {
    for (let i = 0; i < 8; i++) sim.host.step();
    expect(sim.decisions?.host.state(1)).toEqual({ calls: 0 }); expect(sim.decisions?.host.metrics()[0]?.refusals).toBe(1);
    expect(sim.decisions?.publication().fields).toContainEqual({ actor: 1, field: 89, value: 0 });
    expect(sim.host.entities.get('actor.a')?.position.z).toBe(5); expect(sim.host.flags.has('done')).toBe(false);
  } finally { sim.dispose(); }
});

test('fresh-host restore retains a staged strike catalogue and logical decision without Wasm during restore', async () => {
  const f = fixture(), R = await rapier, sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: R });
  let resumed: ShardfileSimulation | undefined;
  try {
    for (let i = 0; i < 6; i++) sim.host.step();
    const saved = snapshotSimHost(sim.host);
    const restored = restoreSimHost(sim.host.level, { rapier: R }, saved, host => { resumed = bindShardfileSim(host, f.source, f.assets, { ...f.options, rapier: R, restoring: true }); });
    const invoke = vi.spyOn(DecisionModule.prototype, 'invoke');
    try { const adapter = restored.adapters.get('decision.declared'); const value = adapter?.snapshot(); if (adapter === undefined || value === undefined) throw new Error('Missing adapter'); adapter.restore(value); expect(invoke).not.toHaveBeenCalled(); }
    finally { invoke.mockRestore(); }
    for (let i = 0; i < 30; i++) { sim.host.step(); restored.step(); }
    expect(snapshotSimHost(restored)).toEqual(snapshotSimHost(sim.host));
  } finally { sim.dispose(); resumed?.dispose(); }
});

test('SDK worker executes the declared v1 section and reports its real fuel rather than admitting it as v0', async () => {
  const { HeadlessSimulation } = await import('../src/server/host/headless');
  const { nameBlob } = await import('../src/sharddev/blobs');
  const { mergeProjectBlobs } = await import('../src/sharddev/projectOutput');
  const f = fixture(); f.source.budgets.sim.resident = 1_000_000;
  const blob = nameBlob('behaviour/controller.wasm', 'wasm', bytes, { script: { abi: 1, pages: 1 }, critical: true });
  const product = mergeProjectBlobs(f.source, new Map(), [blob]);
  const session = await HeadlessSimulation.create(product.shard, product.assets, undefined, { deadline: 'advisory', sections: f.sections });
  try {
    for (let i = 0; i < 5; i++) await session.step();
    const staged = await session.step(); expect(staged.fuelUsed).toBeGreaterThan(0);
    const committed = await session.step(); expect(committed.fuelUsed).toBe(0);
    expect(session.quarantined).toBe(false);
    expect(committed.snapshot).toContain('decision.declared');
    expect(committed.decisions?.fields).toContainEqual({ actor: 1, field: 89, value: 1 });
    expect(committed.decisions?.events.map(row => row.kind)).toEqual(['move', 'strike']);
  } finally { await session.dispose(); }
});

test('encounter bindings sleep until the real fight starts and retain inactive checkpoint state', async () => {
  const f = fixture(bytes, { encounter: 'encounter.0' }), R = await rapier;
  const sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: R });
  let resumed: ShardfileSimulation | undefined;
  try {
    const snapshot = snapshotSimHost(sim.host);
    const restored = restoreSimHost(sim.host.level, { rapier: R }, snapshot, host => { resumed = bindShardfileSim(host, f.source, f.assets, { ...f.options, rapier: R, restoring: true }); });
    expect(sim.decisions?.host.metrics()[0]?.calls).toBe(0);
    expect(resumed?.decisions?.host.snapshot()).toEqual(sim.decisions?.host.snapshot());
    for (let i = 0; i < 7; i++) { sim.host.step(); restored.step(); }
    expect(sim.decisions?.host.state(1)).toEqual({ calls: 1 });
    expect(snapshotSimHost(restored)).toEqual(snapshotSimHost(sim.host));
  } finally { sim.dispose(); resumed?.dispose(); }
});

test('forged auxiliary restore refuses before changing the logical decision or public fields', async () => {
  const f = fixture(), sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: await rapier });
  try {
    for (let i = 0; i < 7; i++) sim.host.step();
    const adapter = sim.host.adapters.get('decision.declared'); if (adapter === undefined) throw new Error('Missing adapter');
    const before = adapter.snapshot(); if (typeof before !== 'string') throw new Error('Missing logical string');
    const forged: unknown = JSON.parse(before);
    if (typeof forged !== 'object' || forged === null) throw new Error('Missing parsed state');
    Reflect.set(forged, 'fields', [[1, 89, 99]]);
    expect(() => adapter.restore(JSON.stringify(forged))).toThrow('field bounds');
    expect(adapter.snapshot()).toBe(before);
  } finally { sim.dispose(); }
});

test('ground queries use the authoritative height and failure reset uses the existing encounter owner', async () => {
  const ground = await module(`if(list(3,0,0,32768,1)!=1 || load<f64>(32768)!=0)unreachable();return 0;`);
  const f = fixture(ground), row = f.scripts[0]; if (row === undefined) throw new Error('Missing script'); row.reads = ['groundHeight'];
  const sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: await rapier });
  try { for (let i = 0; i < 7; i++) sim.host.step(); expect(sim.decisions?.host.state(1)).toEqual({ calls: 1 }); expect(sim.decisions?.host.metrics()[0]?.refusals).toBe(0); }
  finally { sim.dispose(); }
  const reset = fixture(refused, { encounter: 'encounter.0' }), script = reset.scripts[0]; if (script === undefined) throw new Error('Missing script'); script.onFail = 'reset';
  const notices: string[] = [], native = createShardfileSim(reset.source, reset.assets, { ...reset.options, rapier: await rapier, scriptDisabled: event => { notices.push(event.reason); } });
  try {
    for (let i = 1; i <= 18; i++) { if (i === 8 || i === 14) native.decisions?.host.enqueue(1, [1, 0, 0, 0, 0, 0]); native.host.step(); }
    expect(native.decisions?.host.metrics()[0]).toMatchObject({ refusals: 3, disabled: true });
    expect(native.encounters.get('encounter.0')?.boss.state).toBe('armed'); expect(notices).toHaveLength(1);
  } finally { native.dispose(); }
});

test('a v1 boss does not consume an unrelated legacy interaction prompt', async () => {
  const f = fixture();
  f.source.targets.interactions = [{ id: 'button', scene: 'button', label: 'Button', radius: 8, at: [f.source.spawn.x, f.source.spawn.y + 1.62, f.source.spawn.z + 1] }];
  const sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: await rapier });
  try { expect(sim.selectedInteraction()).toBe('button'); expect(() => sim.interact('button')).toThrow('Interaction requires an admitted scene lane'); }
  finally { sim.dispose(); }
});

test('stop cancels movement and windup without cutting an already active strike', async () => {
  const wasm = await compileScript(`export function ws_abi():i32{return 1;} export function ws_init(lo:i32,hi:i32):void{} export function ws_io():i32{return 16384;}
  export function ws_handle():i32 { let count=load<f64>(${state});store<f64>(${state},count+1);if(count==0){${command(0, 2, 1, 1, 2)}return 1;}if(count==1){${command(0, 3, 1, 0, 0)}return 1;}return 0;}`, { abi: 1 });
  const f = fixture(wasm), script = f.scripts[0], strike = f.source.rows.strikes[0]; if (script === undefined || strike === undefined) throw new Error('Missing stop fixture');
  script.on.push('tick'); script.tick = 10; script.commands.push('stop'); strike.active = 0.5;
  const sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: await rapier });
  try {
    for (let i = 0; i < 13; i++) sim.host.step();
    expect(sim.decisions?.host.state(1)).toEqual({ calls: 2 });
    expect(sim.host.strikes.get('actor.a')?.state).toBe('active');
    expect(sim.host.entities.get('actor.b')?.hp).toBe(93);
  } finally { sim.dispose(); }
});

test('a staged orbit samples its starting pose at commit, including fresh-host continuation', async () => {
  const f = fixture();
  f.sections.set('actors/moves', parseActorMoves([{ id: 'approach', kind: 'orbit', center: [0, 0], r: 10, y: 0, speed: 1, turn: 2, ground: true }]));
  const R = await rapier, sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: R }); let resumed: ShardfileSimulation | undefined;
  try {
    sim.host.entities.get('actor.a')?.setMotion(0, 2);
    for (let i = 0; i < 6; i++) sim.host.step();
    const saved = snapshotSimHost(sim.host);
    const restored = restoreSimHost(sim.host.level, { rapier: R }, saved, host => { resumed = bindShardfileSim(host, f.source, f.assets, { ...f.options, rapier: R, restoring: true }); });
    for (let i = 0; i < 20; i++) { sim.host.step(); restored.step(); }
    expect(snapshotSimHost(restored)).toEqual(snapshotSimHost(sim.host));
  } finally { sim.dispose(); resumed?.dispose(); }
});

test('activation delivers the real player handle even without a start subscription', async () => {
  const f = fixture(), row = f.scripts[0]; if (row === undefined) throw new Error('Missing join fixture'); row.on = ['player.join'];
  const sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: await rapier });
  try {
    expect(sim.decisions?.host.snapshot().bindings[0]?.pending[0]).toEqual([15, 0x7fffffff, 0, 0, 0, 0]);
    for (let i = 0; i < 7; i++) sim.host.step();
    expect(sim.decisions?.host.state(1)).toEqual({ calls: 1 });
  } finally { sim.dispose(); }
});

test('retained actors lend their actual body, public memory and strike owner without another simulation', async () => {
  const f = fixture(), sim = createShardfileSim(f.source, f.assets, { rapier: await rapier });
  try {
    const actor = sim.host.entities.get('actor.a'); if (actor === undefined) throw new Error('Missing retained actor');
    actor.mem['phase'] = 2;
    const source = structuredClone(f.source);
    const cosmetic = new ClientChannels('cosmetic'); cosmetic.output('y', cosmetic.constant(0)); source.clientChannels = [cosmetic.build()];
    source.runtime = { kind: 'client-plan', cost: FIXTURE_RUNTIME_COST, binds: ['spawns'], spawns: { homes: [], bosses: [], actors: source.creatures.spawns.map(row => ({
      id: `retained.${row.id}`, kind: row.species, look: row.variant, at: [row.at[0], row.at[2]], yaw: row.yaw,
    })) } };
    source.creatures.spawns = [];
    const owner = sim.host;
    const entities = new Map([...owner.entities].map(([id, body]) => [`retained.${id}`, body]));
    const strikes = new Map<string, NonNullable<ReturnType<typeof owner.strikes.get>>>();
    const actual = (id: string): string => {
      const body = entities.get(id); if (body === undefined) throw new Error('Missing borrowed body'); return body.entityId;
    };
    const row = f.scripts[0]; if (row === undefined) throw new Error('Missing retained binding'); row.actors = { a: 'retained.actor.a', b: 'retained.actor.b' };
    const runtime: DecisionRuntime = { scope: owner.scope, events: owner.events, flags: owner.flags, physics: owner.physics,
      player: leadPlayer(owner), state: owner.state, slots: owner.slots, entities, strikes,
      borrowedActors: new Set(entities.keys()), groundHeightAt: owner.groundHeightAt.bind(owner),
      registerStrikeCatalogue: (id, specs) => {
        owner.registerStrikeCatalogue(actual(id), specs);
        const runner = owner.strikes.get(actual(id)); if (runner === undefined) throw new Error('Missing actual runner'); strikes.set(id, runner);
      }, startDeclaredStrike: (from, to, strike) => owner.startDeclaredStrike(actual(from), actual(to), strike),
      onStep: owner.onStep.bind(owner) };
    expect(() => new ShardDecisions({ ...runtime, borrowedActors: new Set() }, source, f.assets, f.sections, new Map(), sim.quest)).toThrow('two controllers');
    const decisions = new ShardDecisions(runtime, source, f.assets, f.sections, new Map(), sim.quest);
    const view = decisions.strikeObservation('retained.actor.a');
    expect(decisions.publication().fields).toContainEqual({ actor: 1, field: 89, value: 2 });
    for (let i = 0; i < 7; i++) owner.step();
    expect(actor.mem['phase']).toBe(1); expect(view.current?.id).toBe('bump');
    expect(view.state).toBe(owner.strikes.get(actor.entityId)?.state);
    expect(view.aim).toBe(owner.strikes.get(actor.entityId)?.yaw);
    expect(runtime.strikes.get('retained.actor.a')).toBe(owner.strikes.get(actor.entityId));
    expect(owner.entities.get(actor.entityId)).toBe(actor); expect(owner.entities.size).toBe(2);
    for (let i = 0; i < 3; i++) owner.step();
    expect(owner.entities.get('actor.b')?.hp).toBe(93);
    expect(decisions.host.snapshot().bindings[0]?.pending.some(event => event[0] === 7 && event[1] === 2 && event[2] === 1)).toBe(true);
    actor.mem['phase'] = 3;
    expect(decisions.publication().fields).toContainEqual({ actor: 1, field: 89, value: 3 });
    const saved = decisions.snapshot(), invoke = vi.spyOn(DecisionModule.prototype, 'invoke');
    try {
      actor.mem['phase'] = 0; decisions.restore(saved);
      expect(actor.mem['phase']).toBe(3); expect(decisions.snapshot()).toBe(saved); expect(invoke).not.toHaveBeenCalled();
      const legacy = v.parse(v.record(v.string(), v.unknown()), JSON.parse(saved));
      const declaration = v.parse(v.record(v.string(), v.unknown()), JSON.parse(v.parse(v.string(), legacy['contract'])));
      const olderView = new ClientChannels('cosmetic'); olderView.output('y', olderView.constant(1));
      declaration['channels'] = [olderView.build()]; declaration['movers'] = [];
      legacy['contract'] = JSON.stringify(declaration);
      decisions.restore(JSON.stringify(legacy)); expect(decisions.snapshot()).toBe(saved); expect(invoke).not.toHaveBeenCalled();
      declaration['state'] = {}; legacy['contract'] = JSON.stringify(declaration);
      expect(() => decisions.restore(JSON.stringify(legacy))).toThrow('Incompatible decision continuation');
      expect(decisions.snapshot()).toBe(saved);
      const bad: unknown = JSON.parse(saved);
      if (typeof bad !== 'object' || bad === null) throw new Error('Missing continuation');
      Reflect.set(bad, 'fields', [[1, 89, 99], [2, 89, 0]]);
      expect(() => decisions.restore(JSON.stringify(bad))).toThrow('field bounds');
      expect(actor.mem['phase']).toBe(3); expect(decisions.snapshot()).toBe(saved);
    } finally { invoke.mockRestore(); }
    owner.strikes.get(actor.entityId)?.cancel(); expect(view.current).toBeNull();
  } finally { sim.dispose(); }
});

test('native strike sections reach the existing runner with their world-space geometry', async () => {
  const f = fixture(), original = f.source.rows.strikes[0];
  if (original === undefined) throw new Error('Missing native strike fixture');
  f.source.rows.strikes = [];
  f.sections.set('actors/strikes', [{ ...original, shape: { kind: 'sphere', radius: 26 }, range: 30,
    units: 'world', weight: { kind: 'constant', value: 1 }, motion: { speed: 0 } }].map(({ speed: _speed, ...row }) => row));
  const sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: await rapier });
  try {
    for (let i = 0; i < 8; i++) sim.host.step();
    expect(sim.decisions?.registries.strikes?.get('bump')).toBe(1);
    expect(sim.host.strikes.get('actor.a')?.spec).toMatchObject({ range: 30, shape: { radius: 26 }, units: 'world' });
    for (let i = 0; i < 29; i++) sim.host.step();
    expect(sim.host.entities.get('actor.b')?.hp).toBe(93);
    expect(sim.decisions?.host.metrics()[0]?.refusals).toBe(0);
  } finally { sim.dispose(); }
});

test('multi-strike readiness uses its named strike and takeoff resolves the admitted perch', async () => {
  const f = fixture(), strike = f.source.rows.strikes[0];
  if (strike === undefined) throw new Error('Missing range fixture');
  f.source.rows.strikes.push({ ...strike, id: 'z.unused', range: 0.1 });
  f.sections.set('actors/moves', parseActorMoves([{ id: 'approach', kind: 'stalk', speed: 1, turn: 2,
    ground: true, above: 0, standOff: 0, ready: { kind: 'range', strike: 'bump' } }]));
  const script = f.scripts[0]; if (script === undefined) throw new Error('Missing range script'); script.strikes['unused'] = 'z.unused';
  const R = await rapier, sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: R });
  try { for (let i = 0; i < 13; i++) sim.host.step(); expect(sim.decisions?.host.metrics()[0]).toMatchObject({ refusals: 0 }); }
  finally { sim.dispose(); }
  const flight = fixture(); const species = flight.source.rows.species[0]; if (species === undefined) throw new Error('Missing flight species');
  species.flight = { altitude: 1, above: 'world', climbRate: 1, diveRate: 1 };
  flight.sections.set('actors/moves', parseActorMoves([{ id: 'approach', kind: 'takeoff', speed: 1, turn: 2,
    ground: false, perch: 'home', altitude: 3, seconds: 1, bank: 0.3 }]));
  flight.sections.set('world/targets', { targets: [], spots: [{ id: 'home', at: [0, 1, 5], yaw: 0 }] });
  const flying = createShardfileSim(flight.source, flight.assets, { ...flight.options, rapier: R });
  try { for (let i = 0; i < 13; i++) flying.host.step(); expect(flying.decisions?.host.metrics()[0]).toMatchObject({ refusals: 0 }); }
  finally { flying.dispose(); }
});


test('a refused asynchronous strike acknowledges completion instead of stranding its guest', async () => {
  const f = fixture(), sim = createShardfileSim(f.source, f.assets, { ...f.options, rapier: await rapier });
  try {
    vi.spyOn(sim.host, 'startDeclaredStrike').mockReturnValue(false);
    for (let tick = 0; tick < 7; tick++) sim.host.step();
    expect(sim.decisions?.host.snapshot().bindings[0]?.pending).toContainEqual([11, 1, 1, 0, 0, 0]);
    expect(sim.host.strikes.get('actor.a')?.busy).toBe(false);
  } finally { sim.dispose(); }
});


test('retained pose and eased depth read one admitted body and refuse a bad frame atomically', async () => {
  const f=fixture(await module('return 0;')),sim=createShardfileSim(f.source,f.assets,{rapier:await rapier});
  try{
    const actor=sim.host.entities.get('actor.a');if(actor===undefined)throw new Error('Missing retained pose body');
    const source=structuredClone(f.source);source.creatures.spawns=[];
    source.runtime={ kind: 'client-plan', cost: FIXTURE_RUNTIME_COST, binds:['spawns'],spawns:{homes:[],actors:[],bosses:[
      {id:'actor.a',kind:'boar',look:'boar',at:[0,5],yaw:0},{id:'actor.b',kind:'boar',look:'boar',at:[0,7],yaw:0}]}};
    source.state.shared.push({id:90,name:'lift',type:'f64',privacy:'public',default:0,min:0,max:1});
    const script=f.scripts[0];if(script===undefined)throw new Error('Missing pose fixture guest');
    script.actors={a:'actor.a'};script.commands=[];script.fields={};script.flags={};script.moves={};script.strikes={};
    const owner=sim.host,authority=borrowedDecisionAuthority(source,f.assets,f.sections,{scope:owner.scope,events:owner.events,
      flags:owner.flags,physics:owner.physics,player:leadPlayer(owner),groundHeightAt:(x,z)=>owner.groundHeightAt(x,z),
      live:body=>owner.entities.get(body.entityId)===body,fixed:(id,run,scope)=>{scope.onDispose(owner.onStep(id,run));}});
    const control=authority.bind(actor,{script:'controller',actor:'actor.a',strikeEffects:[]},{kind:'animal',motion:'ground',attack:'keeper',stunned:'none',
      contact:{kind:'environment',halfArc:Math.PI},actions:{stateKey:'phase',states:['hide','attack','idle','perch'],actions:[]},offset:{field:'lift',from:-2.8,to:0}});
    control.observe({calm:false,reach:()=>true,claim:()=>true,hurt:()=>undefined});
    actor.mem['phase']=1;actor.mem['lift']=.25;owner.step();
    const unrelated=owner.entities.get('actor.b');if(unrelated===undefined)throw new Error('Missing other retained body');
    unrelated.applyFinalDamage(1,unrelated.position,unrelated.position);
    expect(()=>owner.step()).not.toThrow();
    expect(actor.state).toBe('attack');expect(actor.yOffset).toBeCloseTo(-2.8+2.8*.25*.25*(3-2*.25));
    expect(owner.entities.get(actor.entityId)).toBe(actor);const beforeState=actor.state,depth=actor.yOffset;
    actor.mem['phase']=2;actor.mem['lift']=2;
    expect(()=>owner.step()).toThrow('normalized body offset');expect(actor.state).toBe(beforeState);expect(actor.yOffset).toBe(depth);
  }finally{sim.dispose();}
});


test('a yielded spawn-group build publishes its step only after every declared body binds', async () => {
  const f = fixture(await module('return 0;')), sim = createShardfileSim(f.source, f.assets, { rapier: await rapier });
  try {
    const source = structuredClone(f.source); source.creatures.spawns = [];
    source.runtime = { kind: 'client-plan', cost: FIXTURE_RUNTIME_COST, binds: ['spawns'], spawns: { homes: [], actors: [], bosses: [
      { id: 'actor.a', kind: 'boar', look: 'boar', at: [0, 5], yaw: 0 },
      { id: 'actor.b', kind: 'boar', look: 'boar', at: [0, 7], yaw: 0 },
    ] } };
    const script = f.scripts[0]; if (script === undefined) throw new Error('Missing group fixture guest');
    script.binding = { spawnGroup: 'fixture.pack' }; script.commands = []; script.fields = {}; script.flags = {}; script.moves = {}; script.strikes = {};
    for (const slot of script.state) slot.scope = 'actor';
    const owner = sim.host, fixed = new Map<string, () => void>();
    const authority = borrowedDecisionAuthority(source, f.assets, f.sections, { scope: owner.scope, events: owner.events,
      flags: owner.flags, physics: owner.physics, player: leadPlayer(owner), groundHeightAt: (x, z) => owner.groundHeightAt(x, z),
      live: body => owner.entities.get(body.entityId) === body,
      fixed: (id, run, scope) => { if (fixed.has(id)) throw new Error('Duplicate group step'); fixed.set(id, run); scope.onDispose(() => { fixed.delete(id); }); },
    });
    const a = owner.entities.get('actor.a'), b = owner.entities.get('actor.b');
    if (a === undefined || b === undefined) throw new Error('Missing group fixture bodies');
    const bind = (actor: typeof a) => authority.bind(actor, { script: 'controller', group: 'fixture.pack', strikeEffects: [] },
      { kind: 'animal', motion: 'ground', attack: 'keeper', stunned: 'none', contact: { kind: 'environment', halfArc: Math.PI } });
    const first = bind(a);
    expect(fixed.size).toBe(0);
    expect(() => first.snapshot()).toThrow('bodies must be bound');
    // A real fixed boundary between body batches has no partial authority to run.
    owner.step(); for (const run of fixed.values()) run();
    bind(b); expect(fixed.size).toBe(1);
    expect(bind(a)).toBe(first); expect(fixed.size).toBe(1);
    for (const run of fixed.values()) run();
    const saved = first.snapshot(); first.restore(saved); expect(first.snapshot()).toBe(saved);
    owner.dispose(); expect(fixed.size).toBe(0);
  } finally { sim.dispose(); }
});

// A grid region left on one revision and re-entered on the next restores its portable progress logically: the fresh
// simulation resumes at the saved tick while its sim decisions are fresh. They must continue from that tick, or every
// fixed step after the crossing threw 'nonconsecutive step' and the grid's live post-step system switched itself off
// (the iOS Simulator, entering the template with a save from an older build).
test('a region re-entered after a revision keeps its decision clock in step', async () => {
  // No shared field: a lane-less region's portable progress is its flags and quests, so logical restore admits it.
  const f = fixture(), R = await rapier, local = new Map<string, string>(), row = f.scripts[0];
  if (row === undefined) throw new Error('Missing script fixture');
  f.source.state.shared = []; row.fields = {}; row.commands = row.commands.filter(name => name !== 'field');
  const storage = { get length() { return local.size; }, key: (i: number) => [...local.keys()][i] ?? null, getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, value: string) => { local.set(k, value); }, removeItem: (k: string) => { local.delete(k); }, clear: () => { local.clear(); } };
  const identity = { id: 'decision-sim-1', shard: f.source.identity.slug };
  const before = new GridRegionDurability(new SaveStore({ local: storage, session: null }), identity, f.source, []);
  const first = createShardfileSim(f.source, f.assets, { ...f.options, rapier: R, quest: before.quest });
  let fresh: ShardfileSimulation | undefined;
  try {
    before.setPhysicsBasis(first.host.physics.snapshot()); before.bind(first.host, first.colliders);
    for (let i = 0; i < 9; i++) first.host.step();
    expect(first.decisions?.host.snapshot().tick).toBe(9);
    expect(before.checkpoint(snapshotSimHost(first.host))).toBe(true);
    const revised = { ...f.source, identity: { ...f.source.identity, revision: f.source.identity.revision + 1 } };
    const after = new GridRegionDurability(new SaveStore({ local: storage, session: null }), identity, revised, []);
    fresh = createShardfileSim(revised, f.assets, { ...f.options, rapier: R, quest: after.quest });
    after.setPhysicsBasis(fresh.host.physics.snapshot());
    expect(after.read(true)).toBeUndefined(); // an older revision: logical progress only
    after.bind(fresh.host, fresh.colliders);
    expect(after.restoreLogical(fresh)).toBe(true);
    expect(fresh.host.state.tick).toBe(9);
    for (let i = 0; i < 12; i++) fresh.host.step();
    expect(fresh.decisions?.host.snapshot().tick).toBe(21);
  } finally { fresh?.dispose(); first.dispose(); }
});


test('an unpublished installed decision owner restores without rebinding or rerunning author work',async()=>{
  const f=fixture(),R=await rapier,first=createShardfileSim(f.source,f.assets,{...f.options,rapier:R});
  for(let tick=0;tick<9;tick++)first.host.step();const saved=snapshotSimHost(first.host);
  const target=prepareShardfileSimRestore(f.source,f.assets,{...f.options,rapier:R}),decisions=target.simulation.decisions;
  const invoke=vi.spyOn(DecisionModule.prototype,'invoke');
  try{
    expect(decisions).toBeDefined();target.restore(saved);expect(invoke).not.toHaveBeenCalled();
    expect(target.simulation.decisions).toBe(decisions);expect(snapshotSimHost(target.host)).toEqual(saved);
    for(let tick=0;tick<18;tick++){first.host.step();target.host.step();}
    expect(snapshotSimHost(target.host)).toEqual(snapshotSimHost(first.host));
  }finally{invoke.mockRestore();target.host.dispose();first.dispose();}
});
