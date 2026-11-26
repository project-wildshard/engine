// TC45/J186: explicit real-gateway integration, outside hook discovery.
/* oxlint-disable import/no-nodejs-modules -- This explicit Node proof owns native gateway clients and child CLI processes. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {roomBench, serverInput} from './fixtures/dedicated/roomBench.ts';
import {RoomBot} from './fixtures/dedicated/roomBot.ts';
import {outsideJourney} from './fixtures/dedicated/outsideJourney.ts';

let bench, room;
let prepared = false;
const bots = [];
const sleep = ms => new Promise(resolve => {setTimeout(resolve, ms);});
async function until(ready, ms = 1000) {
  const end = performance.now() + ms;
  while (!ready()) {if (performance.now() > end) throw new Error('fixture deadline'); await sleep(5);}
}
async function prepare() {
  // Admit the real pinned product before creating worker ports. A bad product
  // must reject here rather than leave an unfinished World.open behind.
  const input = await serverInput('driftwood-isle');
  bench = await roomBench({workers: 1, holdMs: 30000, load: () => Promise.resolve(input)});
  const warm = new RoomBot(bench.url, 'bench', 'device:tc45-warm'); bots.push(warm);
  assert.equal(await warm.arrived(4000), true);
  room = bench.room('driftwood-isle'); assert.ok(room);
  const target = [...room.host.entities.values()].find(row => row.alive && row.hp >= 60 && row.kind === 'boar');
  assert.ok(target, 'real pinned ordinary creature');
  for (const row of room.host.entities.values()) row.harnessHold = true;
  // Fixture layout only, before either measured player exists. The journey
  // itself can only read wire state and send ordinary player input.
  Object.assign(room.host.level.player.at, {x: target.position.x + 5, y: target.position.y + .2, z: target.position.z});
  warm.stop(); warm.transport.control('ready', new Uint8Array([1]).buffer);
  assert.equal(await warm.ended(1000), 'closed'); warm.drop();
  await until(() => bench.world.health().players === 0 && room.holding === 0);
  prepared = true;
}
try {
await test('outside mode refuses replica, private routing and extra clients before any network work', () => {
  for (const args of [['replica', '--outside-proof'], ['staging', '--outside-proof', '--tailnet'], ['staging', '--outside-proof', '--bots', '2'],
    ['staging', '--outside-proof', '--remote', 'example.invalid'], ['staging', '--outside-proof', '--bots-on-host']]) {
    const child = spawnSync(process.execPath, ['src/scripts/mmo-bots.mjs', ...args], {encoding: 'utf8', timeout: 2000});
    assert.notEqual(child.status, 0); assert.match(child.stderr, /outside-proof/u);
  }
});
await test('ordinary inputs walk, damage, drop, resume the same real body and release its seat', {timeout: 8000}, async () => {
  await prepare();
  const connect = () => {const bot = new RoomBot(bench.url, 'bench', 'device:tc45-positive'); bots.push(bot); return bot;};
  const report = await outsideJourney(connect, 5000);
  assert.equal(report.complete, true); assert.equal(report.left, true);
  assert.ok(report.walkedMeters >= 1);
  assert.ok(report.fight.afterHp < report.fight.beforeHp);
  assert.ok(report.fight.amount > 0 && report.fight.confirmedSeq > 0);
  assert.equal(report.beforeDrop.player, report.resumed.player);
  assert.equal(report.beforeDrop.handle, report.resumed.handle);
  assert.ok(report.resumed.tick > report.beforeDrop.tick);
  await until(() => bench.world.health().players === 0 && room.holding === 0);
  assert.equal(room.bodyOf('device:tc45-positive'), undefined);
  assert.deepEqual(bench.crashes, []);
});

await test('real damage without a delivered hit confirmation cannot complete and still releases', {timeout: 5000}, async () => {
  assert.ok(prepared, 'real gateway fixture must have finished preparation');
  let suppressed = 0;
  const healthBefore = new Map([...room.host.entities].map(([id, row]) => [id, row.hp]));
  const connect = () => {
    const bot = new RoomBot(bench.url, 'bench', 'device:tc45-no-confirmation'); bots.push(bot);
    const subscribe = bot.client.onCombat.bind(bot.client);
    // Named negative fault only: the actual client still decodes real server
    // combat, but this observer loses its hit messages. The happy path is untouched.
    bot.client.onCombat = listener => subscribe(event => {
      if (event.kind === 'hit' && event.confirmFor > 0) suppressed++;
      else listener(event);
    });
    return bot;
  };
  await assert.rejects(outsideJourney(connect, 1500), /journey deadline/u);
  assert.ok(suppressed > 0, 'the real server settled hits; only their observation was dropped');
  assert.ok([...room.host.entities].some(([id, row]) => row.hp < (healthBefore.get(id) ?? row.hp)), 'actual server creature health fell');
  await until(() => bench.world.health().players === 0 && room.holding === 0);
  assert.equal(room.bodyOf('device:tc45-no-confirmation'), undefined);
  assert.deepEqual(bench.crashes, []);
});

await test('cancelling an admitted player releases its actual body and local client', {timeout: 5000}, async () => {
  assert.ok(prepared, 'real gateway fixture must have finished preparation');
  const abort = new AbortController();
  const connect = () => {
    const bot = new RoomBot(bench.url, 'bench', 'device:tc45-abort'); bots.push(bot);
    return bot;
  };
  const journey = outsideJourney(connect, 3000, abort.signal);
  await until(() => bench.world.health().players === 1 && room.bodyOf('device:tc45-abort') !== undefined);
  assert.equal(bench.world.health().players, 1); assert.ok(room.bodyOf('device:tc45-abort'));
  abort.abort(new Error('tc45 cancelled'));
  await assert.rejects(journey, /tc45 cancelled/u);
  await until(() => bench.world.health().players === 0 && room.holding === 0);
  assert.equal(room.bodyOf('device:tc45-abort'), undefined);
  assert.deepEqual(bench.crashes, []);
});

} finally {for (const bot of bots) bot.drop(); await bench?.close();}
