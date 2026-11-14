// oxlint-disable-next-line import/no-nodejs-modules -- The native host consumes the shipped physics binary.
import { installNativeBodyScripts } from '@wildshard/engine/game/quest/nativeBodyScripts';
import { installBodyScripts } from '@wildshard/engine/game/shardfile/nativeRuntimeLoans';
import type { HeadlessRuntimePlan } from '@wildshard/engine/host/headlessRuntime';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { DeclaredBodyOpsSchema } from '@wildshard/format/bodySlots';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { beforeAll,expect,test } from 'vitest';
import { createSimHost,type SimHost } from '../src/server/engine/sim';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { Bodies } from '../src/shared/engine/physics/bodies';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { BARREL_BODY,BARREL_HALF } from '../src/shared/engine/world/interact/barrel';
import { NativeQuestProps } from '../src/shared/game/quest/nativeProps';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { emptyShardfile } from '../src/shared/host/author';
import { SIM_LEVEL } from './fixtures/sim-level/level';

import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { builtFolder } from './fixtures/engine-lift/folder';
const published = await loadHeadlessFolder(builtFolder('driftwood-isle'));
const BARREL_DECISION = parseDecisionScripts(published.section('sim/scripts'));
const BARREL_BODIES = v.parse(DeclaredBodyOpsSchema, published.section('sim/bodies'));
// G566: Driftwood's tide barrel moved from the quest props' kit watch into its decision script over a declared body. The
// body scripts add no snapshot adapter and the quest envelope keeps the barrel's native handle (plus, since G566, the
// script continuation), so an old save adopts its barrel body with no second spawn, and a migrated save restores the same
// body, handle, position and watch clocks.
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
const level = { ...SIM_LEVEL, entities: [], quests: [] };
const OWNER = 'tide-barrel', HOME = { x: 2, y: 0, z: 2 }, LIFT = HOME.y + BARREL_HALF + 0.01;
const watch = BARREL_DECISION.find(row => 'shard' in row.binding && Object.keys(row.bodies ?? {}).length > 0), [declared] = BARREL_BODIES.bodies;
if (watch === undefined) throw new Error('Missing pinned barrel watch');
if (declared === undefined) throw new Error('Missing declared barrel');
// the barrel moved next to the fixture spawn, with the sea above its flat ground: off home it is lost
const bodies = v.parse(DeclaredBodyOpsSchema, { ...BARREL_BODIES, bodies: [{ ...declared, at: { x: HOME.x, y: LIFT, z: HOME.z } }] });
const params = { ...watch.params, homeX: HOME.x, homeY: HOME.y, homeZ: HOME.z, water: 10, plateAX: 90, plateBX: -90 };
const source = emptyShardfile({ slug: 'barrel-saves', name: 'Barrel Saves', author: 'Test', seed: 3, revision: 1 });
let sections = new Map<string, unknown>(), assets = new Map<string, Uint8Array>();
let nativePlan: HeadlessRuntimePlan;
beforeAll(async () => {
  const module = outputDescriptor(published.shardfile)?.index.files.find(file => `blobs/wasm/${file.hash}.wasm` === watch.module);
  if (module?.name === undefined) throw new Error('Missing pinned barrel module');
  const built = { rows: [{ ...watch, params }], blobs: [{ bytes: await published.file(module.name) }] };
  const [row] = built.rows, [blob] = built.blobs; if (row === undefined || blob === undefined) throw new Error('Missing barrel program');
  sections = new Map<string, unknown>([['sim/scripts', parseDecisionScripts([row])], ['sim/bodies', bodies],
    // This admitted registry is outside sim/bodies but is still part of the
    // exact legacy decision contract carried by the barrel's save envelope.
    ['world/targets', { targets: [], spots: [{ id: 'fixture.unchanged', at: [3, 4, 5], yaw: .25 }] }]]);
  assets = new Map([[row.module.slice('blobs/wasm/'.length, -'.wasm'.length), blob.bytes]]);
  const product = createShardFolder({ slug: source.identity.slug, revision: 1, shardfile: source, sections,
    files: new Map(), read: () => Promise.reject(new Error('Body-script proof reads admitted sections only')) });
  const preparation = { shard: source, product, assets, rapier: await rapier };
  nativePlan = { level, install: (host, context) => { installBodyScripts(host, context, preparation); } };
});
const envelope = v.strictObject({ barrel: v.unknown() });
/** The quest composition's barrel envelope over today's props and body scripts. */
function migrated(host: SimHost, restoring: boolean, builtin = true): NativeQuestProps {
  if (builtin) nativePlan.install(host, { restoring, commands: () => [], emit: () => undefined });
  else installNativeBodyScripts(host, source, assets, restoring, sections);
  const props = new NativeQuestProps(host, { drops: [], floors: [], gates: [], bodies: [{ owner: OWNER, body: 'barrel' }] }, restoring);
  host.onStep('quest.props', dt => { props.step(dt, { x: 0, z: 0 }); }, {
    snapshot: () => ({ barrel: props.snapshot(OWNER) }), restore: value => { props.restore(OWNER, v.parse(envelope, value).barrel); },
    physicsRestored: () => { props.physicsRestored(); } });
  return props;
}
const at = (host: SimHost, handle: number) => { const { x, y, z } = host.physics.world.getRigidBody(handle).translation(); return { x, y, z }; };
const fromHome = (host: SimHost, handle: number) => Math.hypot(at(host, handle).x - HOME.x, at(host, handle).z - HOME.z);
const handleOf = (props: NativeQuestProps) => { const saved = props.snapshot(OWNER); if (saved === null) throw new Error('Missing barrel body'); return saved.handle; };
const clocksOf = (props: NativeQuestProps) => {
  const saved = props.snapshot(OWNER)?.decision;
  return (JSON.parse(saved ?? 'null') as { decision: { bindings: { slots: Record<string, number> }[] } }).decision.bindings[0]?.slots;
};

test('an old save adopts its barrel body: same body count, handle and position, no second spawn, the script steers it', async () => {
  const R = await rapier, host = createSimHost(level, { rapier: R });
  try {
    // the pre-G566 props spawned and saved their own barrel body, with the kit watch clocks (now dropped)
    const service = new Bodies(host.physics, leadPlayer(host).position);
    const body = service.spawn({ ...BARREL_BODY, owner: { kind: 'barrel', id: OWNER } }, { x: HOME.x, y: LIFT, z: HOME.z }, undefined,
      { x: 0, y: Math.sin(declared.yaw / 2), z: 0, w: Math.cos(declared.yaw / 2) });
    host.onStep('quest.props', dt => { service.post(dt); service.pre(dt); }, {
      snapshot: () => ({ barrel: { handle: body.rb.handle, watch: { lost: 1.5, wedge: 0.5, from: { x: 1, y: 2, z: 3 } } } }), restore: () => undefined });
    for (let i = 0; i < 30; i++) host.step();
    body.rb.setTranslation({ x: HOME.x + 2, y: LIFT, z: HOME.z }, true); host.step();
    const saved = snapshotSimHost(host), count = host.physics.world.bodies.len(), was = at(host, body.rb.handle);
    let props: NativeQuestProps | undefined;
    const fork = restoreSimHost(level, { rapier: R }, saved, fresh => { props = migrated(fresh, true); });
    try {
      if (props === undefined) throw new Error('Missing restored props');
      expect(fork.physics.world.bodies.len()).toBe(count); expect(handleOf(props)).toBe(body.rb.handle); expect(at(fork, body.rb.handle)).toEqual(was);
      for (let i = 0; i < 120; i++) fork.step();
      expect(fork.physics.world.bodies.len()).toBe(count); expect(fromHome(fork, body.rb.handle)).toBeGreaterThan(1);
      // its watch now runs in the script: lost off home (the sea is above this ground) for 4 s, it goes home
      for (let i = 0; i < 240; i++) fork.step();
      expect(fork.physics.world.bodies.len()).toBe(count); expect(handleOf(props)).toBe(body.rb.handle);
      expect(fromHome(fork, body.rb.handle)).toBeLessThan(0.5);
    } finally { fork.dispose(); }
  } finally { host.dispose(); }
});

test('a migrated save restores into a fresh host with the same body count, handle, position and watch clocks', async () => {
  const R = await rapier, host = createSimHost(level, { rapier: R });
  try {
    const props = migrated(host, false);
    for (let i = 0; i < 30; i++) host.step();
    const handle = handleOf(props); host.physics.world.getRigidBody(handle).setTranslation({ x: HOME.x + 2, y: LIFT, z: HOME.z }, true);
    for (let i = 0; i < 90; i++) host.step();
    const saved = snapshotSimHost(host), count = host.physics.world.bodies.len(), clocks = clocksOf(props);
    expect(clocks?.['lost']).toBeGreaterThan(1);
    let restored: NativeQuestProps | undefined;
    const fork = restoreSimHost(level, { rapier: R }, saved, fresh => { restored = migrated(fresh, true); });
    try {
      if (restored === undefined) throw new Error('Missing restored props');
      expect(fork.physics.world.bodies.len()).toBe(count); expect(handleOf(restored)).toBe(handle);
      expect(at(fork, handle)).toEqual(at(host, handle)); expect(clocksOf(restored)).toEqual(clocks);
      expect(snapshotSimHost(fork)).toEqual(saved);
      // both continue identically: the same tick takes the barrel home
      for (let i = 0; i < 240; i++) { host.step(); fork.step(); expect(at(fork, handle)).toEqual(at(host, handle)); }
      expect(fromHome(fork, handle)).toBeLessThan(0.5);
      expect(snapshotSimHost(fork)).toEqual(snapshotSimHost(host)); expect(fork.physics.world.bodies.len()).toBe(count);
    } finally { fork.dispose(); }
  } finally { host.dispose(); }
});
