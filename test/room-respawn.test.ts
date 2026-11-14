// oxlint-disable-next-line import/no-nodejs-modules -- The product and Rapier are shipped bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { snapshotSimHostBytes, serializeSimSnapshot } from '../src/shared/engine/sim/snapshot';
import { FALL_FADE } from '../src/server/engine/sim/respawn';
import { DARK_UNTIL, FADE_IN } from '../src/client/engine/ui/DeathFade';
import { LastPlace } from '../src/shared/engine/quest/lastPlace';
import { installRoomRespawn } from '../src/server/game/roomRespawn';
import { serverPlaces } from '../src/server/game/quest/serverPlaces';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { RESPAWN_NOW_ACT } from '../src/shared/engine/net/acts';
import { netInteractCommands } from '../src/shared/host/standalone/netInput';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder } from './fixtures/builtFolder';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// J107: a fallen player returns to their own last place, alone, while the room carries on.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const SPOT = { id: 'spot', label: 'THE SPOT', x: 2, z: 0, r: 3 };
function room(): { host: SimHost } {
  const host = createSimHost(SIM_LEVEL, { rapier }); installRoomRespawn(host, [SPOT]); return { host };
}
const kill = (host: SimHost, id: string): void => {
  const player = host.players.get(id); if (player === undefined) throw new Error('No such player');
  host.combat.hit({ source: 'env', sourceTags: [], target: player.health, amount: 1000, point: player.position.clone(), dir: new Vector3(0, 0, 1) });
};

test('the fade is the page\'s', () => { expect(FALL_FADE).toBeCloseTo(DARK_UNTIL + FADE_IN, 6); });

test('a fallen player goes back alone to the place they reached, and everyone else carries on', () => {
  const { host } = room(), lead = [...host.players.values()][0];
  if (lead === undefined) throw new Error('No lead');
  const other = host.addPlayer('bot:1', { x: 8, y: lead.position.y, z: 8 });
  host.step();
  lead.resetPose({ x: SPOT.x, y: lead.position.y, z: SPOT.z }, 0);
  for (let tick = 0; tick < 60; tick++) host.step();
  const stood = host.respawn.stand(lead.id);
  expect(stood?.id).toBe('spot');
  expect(host.respawn.stand(other.id)).toBeNull();
  lead.resetPose({ x: 12, y: lead.position.y, z: 12 }, 0);
  const before = other.position.clone(), flags = [...host.flags.all];
  host.flags.set('kept'); kill(host, lead.id); host.step();
  expect(host.respawn.falls(lead.id)).toBe(1);
  expect(lead.health.alive).toBe(true);
  expect(lead.position.distanceTo(new Vector3(stood?.x, stood?.y, stood?.z))).toBeLessThan(0.5);
  expect(other.position.distanceTo(before)).toBeLessThan(0.2);
  expect(host.flags.all).toEqual(expect.arrayContaining([...flags, 'kept']));
  // nothing lands while the view is dark
  const hurt = lead.health.attributes.health; kill(host, lead.id); host.step();
  expect(lead.health.attributes.health).toBe(hurt); expect(host.respawn.falls(lead.id)).toBe(1);
  for (let tick = 0; tick < 120; tick++) host.step();
  expect(host.respawn.fading(lead.id)).toBe(false);
});

test('with no place reached, a fallen bot goes to the shard\'s spawn', () => {
  const { host } = room(), bot = host.addPlayer('bot:1', { x: 8, y: 2, z: 8 }), { at } = host.level.player;
  host.step(); kill(host, bot.id); host.step();
  expect(Math.hypot(bot.position.x - at.x, bot.position.z - at.z)).toBeLessThan(0.1);
});

test('a lone player outside a net room is the caller\'s, in the same bytes; a served one returns', () => {
  const quiet = createSimHost(SIM_LEVEL, { rapier }), { host } = room(), lead = [...host.players.values()][0], twin = [...quiet.players.values()][0];
  if (lead === undefined || twin === undefined) throw new Error('No lead');
  for (const each of [quiet, host]) { each.step(); kill(each, [...each.players.keys()][0] ?? ''); each.step(); }
  expect(serializeSimSnapshot(snapshotSimHostBytes(host))).toBe(serializeSimSnapshot(snapshotSimHostBytes(quiet)));
  lead.resetPose({ x: 9, y: lead.position.y, z: 9 }, 0);
  host.respawn.served = true; kill(host, lead.id); host.step();
  expect(Math.hypot(lead.position.x - host.level.player.at.x, lead.position.z - host.level.player.at.z)).toBeLessThan(0.1);
});

test('a restored tracker keeps a place it has not stood in yet', () => {
  const places = [SPOT], one = new LastPlace(() => places), two = new LastPlace(() => places);
  one.observe({ x: 2, y: 1, z: 0, grounded: false }); two.load(structuredClone(one.saved()));
  two.observe({ x: 2, y: 1, z: 0, grounded: true });
  expect(two.stand?.id).toBe('spot');
});

test.each([['pine-hollow', 18], ['nalati-grasslands', 17], ['driftwood-isle', 3]])('%s publishes %i places the server can place', async (slug, count) => {
  const product = await loadHeadlessFolder(builtFolder(slug));
  expect(await serverPlaces(product)).toHaveLength(count);
});

test('Pine: a bot falls on the real shard, comes back, and a save carries its place', async () => {
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const live = await createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product }), { host } = live;
  const first = [...host.players.values()][0]; if (first === undefined) throw new Error('No lead');
  const bot = host.addPlayer('bot:1', { x: 0, y: host.groundHeightAt(0, -212), z: -212 });
  for (let tick = 0; tick < 240; tick++) live.step([]);
  expect(host.respawn.stand(bot.id)?.id).toBe('gate');
  const stood = bot.position.clone();
  bot.resetPose({ x: bot.position.x + 40, y: bot.position.y + 30, z: bot.position.z }, 0);
  kill(host, bot.id); live.step([]);
  expect(host.respawn.falls(bot.id)).toBe(1);
  expect(bot.position.distanceTo(stood)).toBeLessThan(1.5);
  const saved = serializeSimSnapshot(snapshotSimHostBytes(host));
  expect(saved).toContain('"gate"');
  live.dispose();
});

test('QA 11-13 Respawn now: the fallen player asks the server, which ends their fade at once and moves nobody', () => {
  const { host } = room(), lead = [...host.players.values()][0];
  if (lead === undefined) throw new Error('No lead');
  host.respawn.served = true;
  const other = host.addPlayer('bot:1', { x: 8, y: lead.position.y, z: 8 });
  host.step();
  const respawnNow = (id: string): void => { expect(netInteractCommands(actRoutes(host), [{ kind: 'interact', seq: 1, id: RESPAWN_NOW_ACT }], id)).toEqual([]); };
  // standing: the act does nothing (no move, no heal, no fade)
  const stood = lead.position.clone(); lead.health.attributes.health -= 10; const hurt = lead.health.attributes.health;
  respawnNow(lead.id); host.step();
  expect(lead.position.distanceTo(stood)).toBeLessThan(0.2); expect(lead.health.attributes.health).toBe(hurt); expect(actRoutes(host).refused).toBe(0);
  // fallen: the server has placed them and holds their commands for the fade; Respawn now hands them back on the next tick
  kill(host, lead.id); host.step();
  expect(host.respawn.fading(lead.id)).toBe(true); expect(lead.led).toBe(true);
  const placed = lead.position.clone(), otherAt = other.position.clone();
  respawnNow(lead.id); host.step();
  expect(host.respawn.fading(lead.id)).toBe(false); expect(lead.led).toBe(false);
  expect(lead.position.distanceTo(placed)).toBeLessThan(0.2); expect(other.position.distanceTo(otherAt)).toBeLessThan(0.2);
  expect(host.respawn.falls(lead.id)).toBe(1);
  // one player's press never ends another's fade
  kill(host, other.id); host.step();
  respawnNow(lead.id); host.step();
  expect(host.respawn.fading(other.id)).toBe(true);
});
