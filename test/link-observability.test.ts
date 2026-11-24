import { constants } from 'node:perf_hooks';
import { expect, test } from 'vitest';
import { foldGc, gcPauses, type GcKindName } from '../src/server/host/dedicated/gcPauses';
import { deviceClass } from '../src/server/host/dedicated/linkEvents';
import { ServerMetrics } from '../src/server/host/dedicated/serverMetrics';
import { encodeStatsWord, readStatsWord, worldReadsStats, STATS_WORD_MAX_BYTES, type StatsWord } from '../src/shared/engine/net/statsWord';
import { LinkStats } from '../src/client/engine/net/linkStats';

// MMO-OBSERVABILITY OB4 to OB6 (meta docs/plans/MMO-OBSERVABILITY-PLAN.md): every thread's GC, the door's links and the page's own
// 10 s word, as `/metrics` shows them. The live path (a real door, a real bot) is test/dedicated-metrics.test.ts.
const encode = (value: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(value)).buffer;
const rows = async (metrics: ServerMetrics): Promise<ReadonlyMap<string, number>> => new Map((await metrics.text()).split('\n')
  .filter(line => line !== '' && !line.startsWith('#')).map(line => { const at = line.lastIndexOf(' '); return [line.slice(0, at), Number(line.slice(at + 1))] as const; }));

test('OB4: GC entries fold by kind; an unknown kind or a broken duration is dropped', () => {
  const into = new Map<GcKindName, { n: number; ms: number; max: number }>();
  foldGc(into, { duration: 2, detail: { kind: constants.NODE_PERFORMANCE_GC_MINOR } });
  foldGc(into, { duration: 5, detail: { kind: constants.NODE_PERFORMANCE_GC_MINOR } });
  foldGc(into, { duration: 40, detail: { kind: constants.NODE_PERFORMANCE_GC_MAJOR } });
  foldGc(into, { duration: 9, detail: { kind: 999 } });
  foldGc(into, { duration: Number.NaN, detail: { kind: constants.NODE_PERFORMANCE_GC_MAJOR } });
  foldGc(into, { duration: 3 });
  expect(Object.fromEntries(into)).toEqual({ minor: { n: 2, ms: 7, max: 5 }, major: { n: 1, ms: 40, max: 40 } });
});

test('OB4: a real thread sees its own collections, and each read starts a new window', async () => {
  const read = gcPauses();
  let junk: unknown[] = [];
  for (let round = 0; round < 40; round++) { junk = Array.from({ length: 20_000 }, (_, at) => ({ at, text: `row ${String(at)}` })); }
  expect(junk.length).toBe(20_000);
  await new Promise(resolve => { setTimeout(resolve, 50); });
  const first = read();
  expect(first.minor?.n ?? 0).toBeGreaterThan(0);
  expect(read()).toEqual({});
});

test('OB4: a worker reading with GC rows shows per thread, with the build', async () => {
  const metrics = new ServerMetrics(() => undefined, 'staging', { build: 'abc123', serial: 7 });
  try {
    metrics.reading(2, { cells: 1, awake: 1, players: 1, held: 0, ticks: 600, ticksPerSecond: 60, p50: 1, p95: 2, p99: 3, max: 4, drops: 0, rss: 1, heap: 1,
      refused: 0, dropped: 0, frameBytes: 0, eventBytes: 0, gc: { minor: { n: 3, ms: 6, max: 3 }, major: { n: 1, ms: 80, max: 80 } } });
    const scraped = await rows(metrics);
    expect(scraped.get('wildshard_gc_pauses_total{thread="worker-2",kind="minor"}')).toBe(3);
    expect(scraped.get('wildshard_gc_pause_seconds_total{thread="worker-2",kind="major"}')).toBeCloseTo(0.08);
    expect(scraped.get('wildshard_gc_pause_max_seconds{thread="worker-2"}')).toBeCloseTo(0.08);
    expect(scraped.get('wildshard_build_info{build="abc123",serial="7"}')).toBe(1);
  } finally { await metrics.close(); }
});

const WORD: StatsWord = { s: 10, hidden: 0, frames: 290, p50: 33.3, p95: 41.2, max: 180, long: 3, rtt50: 160, rtt95: 240, jitter: 12, re: { hidden: 1 } };

test('OB6: the stats word round-trips; junk, wrong types and oversize are refused whole', () => {
  expect(readStatsWord(encodeStatsWord(WORD))).toEqual(WORD);
  expect(readStatsWord(encode({ ...WORD, extra: 'dropped' }))).toEqual(WORD);
  expect(readStatsWord(encode({ ...WORD, frames: -1 }))).toBeNull();
  expect(readStatsWord(encode({ ...WORD, p95: 'slow' }))).toBeNull();
  expect(readStatsWord(encode({ ...WORD, rtt95: Number.MAX_VALUE }))).toBeNull();
  expect(readStatsWord(encode({ ...WORD, re: { 'Not A Reason': 1 } }))).toBeNull();
  expect(readStatsWord(encode({ ...WORD, re: Object.fromEntries(Array.from({ length: 9 }, (_, at) => [`r${'x'.repeat(at)}`, 1])) }))).toBeNull();
  expect(readStatsWord(new TextEncoder().encode('{').buffer)).toBeNull();
  expect(readStatsWord(new ArrayBuffer(STATS_WORD_MAX_BYTES + 1))).toBeNull();
  expect(readStatsWord(encode([1, 2]))).toBeNull();
  // A page sends it only to a door that says it reads it.
  expect(worldReadsStats(encode({ cells: 1, shards: [], stats: 1 }))).toBe(true);
  expect(worldReadsStats(encode({ cells: 1, shards: [], device: 1 }))).toBe(false);
  expect(worldReadsStats(new TextEncoder().encode('nope').buffer)).toBe(false);
});

test('OB6: the page window counts frames, long ones, round trips, jitter, hidden time and lost links, then starts over', () => {
  let now = 0, rtt = 0, hidden = false;
  const stats = new LinkStats({ rtt: () => rtt, now: () => now, hidden: () => hidden, loops: false });
  try {
    for (let at = 0; at <= 100; at++) stats.frame(at * 16);
    stats.frame(100 * 16 + 120);
    for (const value of [150, 150, 170, 160]) { rtt = value; stats.sampleRtt(); }
    stats.lostLink('hidden'); stats.lostLink('Weird Reason');
    now = 4000; hidden = true; stats.visibility();
    stats.frame(9000);
    now = 7000; hidden = false; stats.visibility();
    now = 10_000;
    const word = stats.take();
    expect(word).toMatchObject({ s: 10, hidden: 3, frames: 101, p50: 16, max: 120, long: 1, rtt50: 160, rtt95: 170, jitter: 15, re: { hidden: 1, other: 1 } });
    expect(readStatsWord(encodeStatsWord(word))).toEqual(word);
    // a word no door heard: its lost links ride the next
    stats.keep(word);
    now = 20_000;
    expect(stats.take()).toEqual({ s: 10, hidden: 0, frames: 0, p50: 0, p95: 0, max: 0, long: 0, re: { hidden: 1, other: 1 } });
  } finally { stats.dispose(); }
});

test('OB5/OB6: the link events land in /metrics by kind, with no player label', async () => {
  const metrics = new ServerMetrics(() => undefined, 'staging');
  const phone = { actor: 'human', device: 'phone' } as const, bot = { actor: 'agent', device: 'desktop' } as const;
  metrics.watch({ health: () => ({}) as never, livePlayers: () => ({ humans: 0, agents: 0, zones: {} }), refusals: { 'stats-word': 2, 'hello-timeout': 1 },
    linkRows: () => [{ ...phone, buffered: 9000, sentBytes: 500, recvBytes: 40, skipped: 2 }, { ...bot, buffered: 10, sentBytes: 100, recvBytes: 10, skipped: 0 }] });
  try {
    metrics.link.rtt(180, phone); metrics.link.rtt(40, bot);
    metrics.link.closed('stalled', phone, { rttMs: 0, lossPct: 0, sentBytes: 1000, recvBytes: 50 }, 4);
    metrics.link.stats(WORD, phone);
    const scraped = await rows(metrics), text = await metrics.text();
    expect(scraped.get('wildshard_sockets_open{actor="human",device="phone"}')).toBe(1);
    expect(scraped.get('wildshard_socket_buffered_bytes_max')).toBe(9000);
    expect(scraped.get('wildshard_socket_bytes_total{direction="out"}')).toBe(1600);
    expect(scraped.get('wildshard_socket_skipped_frames_total')).toBe(6);
    expect(scraped.get('wildshard_door_refusals_total{reason="stats-word"}')).toBe(2);
    expect(scraped.get('wildshard_socket_closes_total{reason="stalled",actor="human",device="phone"}')).toBe(1);
    expect(scraped.get('wildshard_client_rtt_seconds_bucket{le="0.2",actor="human",device="phone"}')).toBe(1);
    expect(scraped.get('wildshard_client_rtt_seconds_bucket{le="0.15",actor="human",device="phone"}')).toBe(0);
    expect(scraped.get('wildshard_client_fps_bucket{le="30",actor="human",device="phone"}')).toBe(1);
    expect(scraped.get('wildshard_client_long_frames_total{actor="human",device="phone"}')).toBe(3);
    expect(scraped.get('wildshard_client_frame_max_seconds_bucket{le="0.2",actor="human",device="phone"}')).toBe(1);
    expect(scraped.get('wildshard_client_rtt_jitter_seconds_bucket{le="0.02",actor="human",device="phone"}')).toBe(1);
    expect(scraped.get('wildshard_client_reconnects_total{reason="hidden",actor="human",device="phone"}')).toBe(1);
    // no label names a player, a seat or a device id
    for (const key of scraped.keys()) expect(key).not.toMatch(/device:|player=|seat=|account=/u);
    expect(text).toContain('wildshard_client_rtt_p95_seconds');
  } finally { await metrics.close(); }
});

test("OB5: a device word's class: phones by the mobile hint or a narrow touch screen", () => {
  expect(deviceClass(undefined)).toBe('unknown');
  expect(deviceClass({ mobile: true })).toBe('phone');
  expect(deviceClass({ touch: 5, screenW: 402, screenH: 874 })).toBe('phone');
  expect(deviceClass({ touch: 0, screenW: 1512, screenH: 982 })).toBe('desktop');
  expect(deviceClass({ touch: 10, screenW: 1366, screenH: 1024 })).toBe('desktop');
});
