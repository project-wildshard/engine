import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import * as v from 'valibot';
import { ItemsSchema } from '@wildshard/format/items';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { nativeRangedHit } from '../src/server/game/plugin/nativeItems';
import { installDeclaredKitItems } from '../src/server/game/shardfile/declaredKitItems';
import { declaredKitSlots } from '../src/shared/game/shardfile/items';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { keepHitHistory } from '../src/server/engine/net/hitHistory';
import { seenBodies, seenRay } from '../src/server/game/plugin/nativeRewind';
import { creatureVolumeFixture, creatureVolumeGlb, volumeJoints } from './fixtures/creature-volume-skin';
import { creatureRestRig } from '../src/shared/game/shardfile/creatureRestRig';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
test.each([{ part: 'head', x: 0, y: 2, damage: 20 }, { part: 'body', x: 0, y: .6, damage: 10 },
  { part: 'shield', x: 1, y: 1, damage: 0 }])('actual declared rifle lands $part at its authored multiplier', async ({ part, x, y, damage }) => {
  const { source, assets } = await creatureVolumeFixture();
  const fixture = v.parse(v.object({ context: v.unknown(), row: v.unknown() }), JSON.parse(readFileSync('test/fixtures/declared-lever/rows.json', 'utf8')));
  source.items = v.parse(ItemsSchema, { ...source.items, contexts: [fixture.context], rows: [fixture.row], loadout: { ...source.items.loadout, primary: 'weapon.fixture-lever' } });
  const sim = createShardfileSim(source, assets, { rapier: await rapier }), kit = installDeclaredKitItems(sim.host, source, sim.itemHooks);
  try {
    const actor = sim.host.entities.get('fixture.actor'), player = sim.host.players.get('actor.player'), slot = declaredKitSlots(source.items.rows).get('weapon.fixture-lever');
    if (actor === undefined || player === undefined || kit === null || slot === undefined) throw new Error('Missing actual rifle fixture');
    const hit = nativeRangedHit([actor], new Vector3(x, y, 0), new Vector3(0, 0, 1), 20);
    expect(hit?.part).toBe(part);
    let dealtPart: string | undefined, count = 0;
    sim.host.events.on('damage.dealt', event => { if (event.req.target.id === actor.entityId) { count++; dealtPart = event.req.part; } }, sim.host.scope);
    expect(kit.equip(player.id, slot)).toBe(true); sim.host.step();
    const hp = actor.hp, direction = new Vector3(x, y - 1.68, 7).normalize();
    const command: NetCommand = { seq: 1, viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0,
      attack: { aim: { origin: { x: 500, y: 500, z: 500 }, direction: { x: direction.x, y: direction.y, z: direction.z } } } };
    kit.command(player.id, command); sim.host.step();
    expect(hp - actor.hp).toBe(damage);
    expect(count).toBe(damage === 0 ? 0 : 1); expect(dealtPart).toBe(damage === 0 ? undefined : part);
    expect(sim.host.entities.size).toBe(1); expect(actor.motor).not.toBeNull();
  } finally { sim.dispose(); }
});
test('rest volumes read actual inverse binds and ignore the animated head in rest mode', async () => {
  const rows = creatureRestRig(creatureVolumeGlb(), volumeJoints);
  expect(JSON.parse(JSON.stringify(rows.map(row => [row.name, row.parent, row.position])))).toEqual([
    ['body', -1, [0, 0, 0]], ['chest', 0, [0, 1, 0]], ['head', 1, [0, 1, 0]], ['hand.L', 1, [1, 0, 0]],
  ]);
  const { source, assets } = await creatureVolumeFixture(), sim = createShardfileSim(source, assets, { rapier: await rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor'); if (actor === undefined) throw new Error('Missing rest body');
    const rng = sim.host.rng.snapshot(), from = new Vector3(0, 2, 0), direction = new Vector3(0, 0, 1);
    for (let tick = 0; tick < 90; tick++) sim.host.step();
    expect(nativeRangedHit([actor], from, direction, 20)?.part).toBe('head');
    expect(sim.host.rng.snapshot()).toEqual(rng);
  } finally { sim.dispose(); }
});
test('volume source and actual ray continuation survive restore; changed or missing authority refuses', async () => {
  const { source, assets } = await creatureVolumeFixture(), sim = createShardfileSim(source, assets, { rapier: await rapier });
  const resumed = prepareShardfileSimRestore(source, assets, { rapier: await rapier });
  try {
    const saved = snapshotSimHost(sim.host); resumed.restore(saved);
    for (let tick = 0; tick < 30; tick++) { sim.host.step(); resumed.host.step(); }
    expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
    const missing = structuredClone(saved); missing.adapters = missing.adapters.filter(row => row.id !== 'creatures.volumes');
    const probe = prepareShardfileSimRestore(source, assets, { rapier: await rapier });
    try { expect(() => probe.restore(missing)).toThrow(); } finally { probe.host.dispose(); }
    const changed = structuredClone(source), body = changed.rows.species[0]?.body;
    if (body?.volumes?.[0] === undefined) throw new Error('Missing shield source');
    body.volumes[0] = { ...body.volumes[0], multiplier: 1 };
    const other = prepareShardfileSimRestore(changed, assets, { rapier: await rapier });
    try { expect(() => other.restore(saved)).toThrow('Incompatible creature volumes'); } finally { other.host.dispose(); }
  } finally { sim.dispose(); resumed.host.dispose(); }
});
test('rewound actual volumes carry part and multiplier to the present without moving the living actor', async () => {
  const { source, assets } = await creatureVolumeFixture(), sim = createShardfileSim(source, assets, { rapier: await rapier });
  try {
    keepHitHistory(sim.host); sim.host.step();
    const actor = sim.host.entities.get('fixture.actor'); if (actor === undefined) throw new Error('Missing rewind body');
    actor.position.x = 10; sim.host.step();
    const seen = seenBodies(sim.host, 1); if (seen === null) throw new Error('Missing actual history');
    const hit = seenRay(seen, new Vector3(0, 2, 0), new Vector3(0, 0, 1), 20);
    expect(hit?.body).toBe(actor); expect(hit?.part).toBe('head'); expect(hit?.multiplier).toBe(2);
    expect(hit?.seen.x).toBeCloseTo(0); expect(hit?.point.x).toBeCloseTo(10); expect(actor.position.x).toBe(10);
  } finally { sim.dispose(); }
});

test.each(['procedural', 'own-rig'] as const)('%s body without hit overrides retains dims and the original save bytes', async kind => {
  const { source, assets } = await creatureVolumeFixture(), species = source.rows.species[0], look = source.rows.looks[0];
  if (species?.body === undefined || look === undefined) throw new Error('Missing fallback source');
  delete species.body.volumes;
  if (kind === 'own-rig') delete species.body.skeleton;
  else look.recipe = 'engine.sphere';
  const before = structuredClone(source), older = before.rows.species[0];
  if (older === undefined) throw new Error('Missing original species');
  delete older.body;
  const sim = createShardfileSim(source, assets, { rapier: await rapier }), native = createShardfileSim(before, assets, { rapier: await rapier });
  try {
    expect(sim.host.entities.get('fixture.actor')?.hitVolumes).toBeUndefined();
    expect(snapshotSimHost(sim.host)).toEqual(snapshotSimHost(native.host));
    for (let tick = 0; tick < 30; tick++) { sim.host.step(); native.host.step(); }
    expect(snapshotSimHost(sim.host)).toEqual(snapshotSimHost(native.host));
  } finally { sim.dispose(); native.dispose(); }
});

for (const giant of [false, true]) test(`actual ${giant ? 'giant named' : 'biped chest'} sockets follow the same actor root`, async () => {
  const { source, assets } = await creatureVolumeFixture(), body = source.rows.species[0]?.body;
  if (body === undefined) throw new Error('Missing socket fixture');
  if (giant) { body.size = 'giant'; body.scale = .25; body.lock = ['head', 'hand.L', 'chest']; }
  const sim = createShardfileSim(source, assets, { rapier: await rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor'); if (actor?.lockPoints === undefined) throw new Error('Missing actual socket actor');
    const before = snapshotSimHost(sim.host), out = new Vector3(), points = actor.lockPoints;
    expect(points.names).toEqual(giant ? ['head', 'hand.L', 'chest'] : ['chest']);
    expect(points.point(0, out).toArray()).toEqual([0, giant ? 2 : 1, 7]);
    for (let n = 0; n < 100; n++) points.point(n % points.names.length, out);
    expect(snapshotSimHost(sim.host)).toEqual(before);
    actor.position.set(10, 3, 20); actor.yaw = Math.PI / 2;
    expect(points.point(0, out).toArray()).toEqual([10, giant ? 5 : 4, 20]);
    if (giant) { const hand = points.point(1, out); expect(hand.x).toBeCloseTo(10); expect(hand.y).toBe(4); expect(hand.z).toBeCloseTo(19); }
  } finally { sim.dispose(); }
});
test('missing authored lock socket refuses before the actor is returned', async () => {
  const { source, assets } = await creatureVolumeFixture(), body = source.rows.species[0]?.body;
  if (body === undefined) throw new Error('Missing socket fixture'); body.lock = ['absent'];
  const physics = await rapier;
  expect(() => createShardfileSim(source, assets, { rapier: physics })).toThrow('Missing creature lock socket absent');
});
test('an own-rig lock-only row keeps native hit volumes', async () => {
  const { source, assets } = await creatureVolumeFixture(), body = source.rows.species[0]?.body;
  if (body === undefined) throw new Error('Missing socket fixture'); delete body.skeleton; delete body.volumes; body.lock = ['head'];
  const sim = createShardfileSim(source, assets, { rapier: await rapier });
  try { const actor = sim.host.entities.get('fixture.actor'); expect(actor?.hitVolumes).toBeUndefined(); expect(actor?.lockPoints?.names).toEqual(['head']); }
  finally { sim.dispose(); }
});
