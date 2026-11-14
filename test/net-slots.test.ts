// FLIP-7: the night's statues on a server. A browser proves a page draws them (`worker-client-fights.mjs`).
// oxlint-disable-next-line import/no-nodejs-modules -- A world runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { questBooks } from '../src/shared/engine/quest/players';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { serializeSimSnapshot, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { slotsOf } from '../src/server/game/boss/slotsNative';
import { slotAwakeRows } from '../src/shared/game/boss/slotLaw';
import { installServerChapters } from '../src/server/game/quest/serverChapters';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder } from './fixtures/builtFolder';

async function nalati(snapshot?: Parameters<typeof createTrustedHeadlessResident>[1]) {
  const directory = builtFolder('nalati-grasslands'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const live = await createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, snapshot, { room: true });
  await installServerChapters(live.host, product, product.shardfile, live.fact);
  return live;
}
const awakeRows = (host: Parameters<typeof shardRows>[0]): number => (shardRows(host).world.get('slots')?.() ?? []).reduce((sum, row) => sum + row.value, 0);

test('night wakes the statues as bodies, their sites go empty on a row, and a kill is a clue', { timeout: 120_000 }, async () => {
  const live = await nalati();
  try {
    const { host } = live, lead = leadPlayer(host), slots = slotsOf(host), book = questBooks(host).of(lead.id);
    if (slots === undefined) throw new Error('No slot owner');
    host.step();
    expect(slots.law.awake).toHaveLength(0);
    expect(awakeRows(host)).toBe(0);
    for (const flag of ['talked:elder', 'tamed:horse', 'won:kokpar', 'told:tulpar', 'talked:elder:2']) book.flags.set(flag);
    actRoutes(host).time?.('night');
    for (let i = 0; i < 180 && slots.law.awake.length === 0; i++) host.step();
    const [out] = slots.law.awake;
    if (out === undefined) throw new Error('Nothing woke');
    expect(awakeRows(host)).toBeGreaterThan(0);
    expect(out.a.kind).toBe('balbal');
    expect(slots.standing()[out.site]).toBe(true);
    expect(slots.solid(out.site).isEnabled(), 'an empty site stops nobody').toBe(false);
    lead.position.set(out.a.position.x + 12, out.a.position.y + 1, out.a.position.z); lead.motor.resetAt(lead.position);
    for (let i = 0; i < 6; i++) host.step();
    const sunk = out.a.position.y - host.groundHeightAt(out.a.position.x, out.a.position.z);
    expect(sunk, 'it starts under the ground').toBeLessThan(-1);
    for (let i = 0; i < 600 && out.a.mem['rise'] !== 1; i++) host.step();
    expect(out.a.position.y - host.groundHeightAt(out.a.position.x, out.a.position.z), 'and stands up out of it').toBeGreaterThan(sunk);
    out.a.combatActor().attributes.health = 0;
    host.events.emit('actor.died', { actor: out.a.combatActor() } as never);
    host.step();
    expect(book.flags.has('clue:1')).toBe(true);
  } finally { live.dispose(); }
});

test('a night out of the ground survives a save', { timeout: 120_000 }, async () => {
  const live = await nalati();
  const { host } = live, slots = slotsOf(host);
  if (slots === undefined) throw new Error('No slot owner');
  host.step();
  actRoutes(host).time?.('night');
  for (let i = 0; i < 180 && slots.law.awake.length === 0; i++) host.step();
  const awake = slots.law.awake.map(row => row.a.entityId), standing = [...slots.standing()], site = slots.law.awake[0]?.site;
  expect(awake.length).toBeGreaterThan(0);
  const saved = serializeSimSnapshot(snapshotSimHostBytes(host));
  live.dispose();
  const back = await nalati(saved);
  try {
    const restored = slotsOf(back.host);
    expect(restored?.law.awake.map(row => row.a.entityId)).toEqual(awake);
    expect(restored?.standing()).toEqual(standing);
    expect(restored?.solid(site ?? -1).isEnabled()).toBe(false);
    back.host.step();
  } finally { back.dispose(); }
});

test('the awake rows carry every site, past one row\'s worth', () => {
  const rows = slotAwakeRows(30), awake = Array.from({ length: 30 }, (_, index) => index === 0 || index === 23 || index === 24 || index === 29);
  const sent = new Map(rows.read(awake).map(row => [row.name, row.value])), heard = Array.from({ length: 30 }, () => false);
  expect(sent.size).toBe(2);
  expect(rows.heard(name => sent.get(name))).toBe(true);
  rows.awake(name => sent.get(name), heard);
  expect(heard).toEqual(awake);
  expect(rows.heard(() => undefined), 'a world with no rows yet says nothing').toBe(false);
});
