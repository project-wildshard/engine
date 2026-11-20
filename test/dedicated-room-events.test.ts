import { Vector3 } from 'three';
import { expect, test, vi } from 'vitest';
import { BossBrain, type BossScript } from '../src/shared/engine/ai/BossBrain';
import { silentBossPresentation } from '../src/server/engine/ai/phases';
import { questBooks } from '../src/shared/engine/quest/players';
import { RoomGameMetrics, type RoomGameCount } from '../src/server/host/dedicated/roomGameMetrics';
import { ServerReports } from '../src/server/host/dedicated/serverReports';
import { RoomSessions } from '../src/server/host/dedicated/roomSessions';
import { type Database } from '../src/server/host/dedicated/saves/database';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { roomGameStore } from '../src/server/host/dedicated/saves/roomGameStore';
import { roomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';
import { openPglite } from './fixtures/pgliteDatabase';

const HOME = 'driftwood-isle';
const fixtureTime = Date.parse('2026-11-19T16:00:00Z');
const noAction = (): void => undefined;

function runBoss(player: { readonly id: string; readonly position: Vector3 }, events: ConstructorParameters<typeof BossBrain>[2]['events']): void {
  const focus = new Vector3(), respawnPoint = () => ({ pos: focus, yaw: 0 });
  let defeated = false;
  const script: BossScript = {
    inArena: () => true, reset: noAction, seal: noAction, intro: () => focus, begin: noAction,
    enterPhase: noAction, update: noAction, get hpFrac() { return defeated ? 0 : 1; }, shielded: false,
    get dead() { return defeated; }, clampHp: noAction, setInvulnerable: noAction, victory: noAction,
    rewardPoint: () => focus, respawnPoint,
  };
  const boss = new BossBrain({ id: 'room-metrics-proof', name: 'Proof', title: 'Proof', retryTitle: 'Retry',
    intro: 0, introShort: 0, phases: [{ at: 1, caption: 'Fight', name: 'Fight' }], reward: {} }, script,
  { ...(events === undefined ? {} : { events }), player, lockInput: noAction, respawn: noAction, skipHeld: () => false,
    faceToward: noAction, spawnReward: noAction, persist: noAction }, silentBossPresentation(), { defeated: false, rewardTaken: false, kills: 0 });
  boss.arm();
  boss.update(1, 1);
  boss.update(1, 2);
  expect(boss.state).toBe('fight');
  expect(boss.onPlayerDeath()).toBe(true);
  boss.update(1, 3);
  boss.update(1, 4);
  defeated = true;
  boss.update(1, 5);
  expect(boss.state).toBe('victory');
}

async function valueByMetric(db: Database): Promise<readonly unknown[]> {
  return (await db.query('select metric, value from metrics_daily where channel = $1 and slug = $2 and actor = $3 order by metric',
    ['staging', HOME, 'agent'])).rows;
}

test('a real cell contributes quest transitions, boss outcomes and time in zone as aggregate counts', { timeout: 120_000 }, async () => {
  const db = await openPglite();
  await migrate(db);
  let now = fixtureTime;
  const reports = new ServerReports({ build: 'bench', channel: 'staging', telemetryUrl: 'http://127.0.0.1/telemetry',
    errorsUrl: undefined, tag: undefined, log: noAction, roomMetricsToken: 'test-room-token' });
  const store = roomGameStore(db);
  let acknowledged = false;
  const game = new RoomGameMetrics({ async write(channel, batch) {
    await store.write(channel, batch);
    if (!acknowledged) { acknowledged = true; throw new Error('lost acknowledgement'); }
  } }, 'staging', rows => { reports.game(rows); }, noAction, () => now);
  const sessions = new RoomSessions({ write: () => Promise.resolve() }, 'staging', 'test-salt', noAction, noAction, () => now);
  sessions.watchGame(game);
  const bench = await roomBench({ sessions });
  const lead = new RoomBot(`${bench.url}?agent=fixture-lead`, 'bench', 'device:fixture-lead');
  let bot: RoomBot | undefined;
  try {
    expect(await lead.arrived()).toBe(true);
    await vi.waitFor(() => { expect(bench.world.health().agents).toBe(1); });
    bot = new RoomBot(`${bench.url}?agent=game-metrics-proof`, 'bench', 'device:game-metrics');
    expect(await bot.arrived()).toBe(true);
    await vi.waitFor(() => { expect(bench.world.health().agents).toBe(2); });
    const room = bench.room(HOME), player = room?.bodyOf('device:game-metrics');
    if (room === undefined || player === undefined) throw new Error('The proof player has no confirmed body');
    const book = questBooks(room.host).of(player.id);
    const quest = book.adopt({ id: 'metrics-quest', title: 'Metrics proof', startWhen: { all: ['metrics-start'] },
      steps: [{ id: 'finish', objective: 'Finish', done: { all: ['metrics-finish'] } }], completeFlag: 'metrics-done' });
    book.flags.set('metrics-start');
    book.flags.set('metrics-finish');
    expect(quest.isComplete).toBe(true);
    runBoss(player, room.host.events);
    room.host.events.flush('update');
    now += 8000;
    bot.quit();
    await vi.waitFor(() => { expect(bench.world.health().players).toBe(1); });
    await game.flush();
    await game.flush();
    const expected = [
      { metric: 'boss-kill', value: 1 }, { metric: 'boss-start', value: 2 }, { metric: 'boss-wipe', value: 1 },
      { metric: 'quest-complete', value: 1 }, { metric: 'quest-start', value: 1 },
      { metric: 'zone-exit', value: 1 }, { metric: 'zone-seconds', value: 8 },
    ];
    expect(await valueByMetric(db)).toEqual(expected);
    const posts: { readonly gameEvents?: readonly RoomGameCount[] }[] = [];
    const post = vi.fn((_url: string, options: RequestInit) => {
      posts.push(JSON.parse(String(options.body)) as typeof posts[number]);
      return Promise.resolve(new Response());
    });
    vi.stubGlobal('fetch', post);
    reports.flushGameMetrics();
    await reports.settled();
    expect(post).toHaveBeenCalledWith('http://127.0.0.1/telemetry', expect.objectContaining({
      headers: expect.objectContaining({ 'x-wildshard-room-metrics': 'test-room-token' }), redirect: 'error',
    }));
    expect(posts).toHaveLength(1);
    const events = posts[0]?.gameEvents ?? [];
    expect(events.map(({ metric, value }) => ({ metric, value })).sort((a, b) => a.metric.localeCompare(b.metric))).toEqual(expected);
    expect(events.every(row => row.actor === 'agent' && row.lane === 'game-metrics-proof' && row.zone === HOME)).toBe(true);
  } finally {
    reports.dispose();
    vi.unstubAllGlobals();
    bot?.drop();
    lead.drop();
    await bench.close();
    await db.close();
  }
});
