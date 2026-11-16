import { expect, test } from 'vitest';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { FailureEpisodes, FailureOutbox } from '../src/client/engine/telemetry/failureEpisodes';
import type { AnalyticsBatch, AnalyticsMap, FailureClear } from '../src/client/engine/telemetry/model';

type Outcome = AnalyticsMap['failure.screen'];
function storage(): SaveStorage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
const episode = (id = 'episode-1234'): Outcome => ({ id, level: 'fixture', screen: 'lost', durationMs: 1200, clear: 'recovered' });

test('repaint preserves the episode; replacement and independent hold cards end with measured causes', () => {
  const outcomes: Outcome[] = [], banner = {}, hold = {};
  let time = 100, id = 0;
  const tracker = new FailureEpisodes(value => { outcomes.push(value); }, () => time, () => `episode-${String(++id)}`);
  tracker.show(banner, 'drop', 'fixture');
  time = 500; tracker.show(banner, 'drop', 'fixture'); tracker.show(hold, 'drop-blocked', 'fixture');
  time = 900; tracker.clear(hold, 'dismissed'); tracker.show(banner, 'lost', 'fixture');
  time = 1100; tracker.clear(banner, 'recovered'); tracker.clear(banner, 'disposed');
  expect(outcomes).toEqual([
    { id: 'episode-2', level: 'fixture', screen: 'drop-blocked', durationMs: 400, clear: 'dismissed' },
    { id: 'episode-1', level: 'fixture', screen: 'drop', durationMs: 800, clear: 'replaced' },
    { id: 'episode-3', level: 'fixture', screen: 'lost', durationMs: 200, clear: 'recovered' },
  ]);
});

test.each(['hidden', 'pagehide', 'disposed'] satisfies FailureClear[])('%s ends visible time and reshow starts another episode', cause => {
  const outcomes: Outcome[] = [], root = {};
  let time = 0, id = 0;
  const tracker = new FailureEpisodes(value => { outcomes.push(value); }, () => time, () => `episode-${String(++id)}`);
  tracker.show(root, 'offline-play', 'fixture'); time = 800; tracker.clearAll(cause);
  time = 10000; tracker.show(root, 'offline-play', 'fixture'); time = 10300; tracker.clearAll('recovered');
  expect(outcomes.map(value => [value.id, value.durationMs, value.clear])).toEqual([['episode-1', 800, cause], ['episode-2', 300, 'recovered']]);
});

test('broken clock is unknown; a measured long episode is retained', () => {
  const outcomes: Outcome[] = [], root = {};
  let time = 100;
  const tracker = new FailureEpisodes(value => { outcomes.push(value); }, () => time, () => 'episode-long');
  tracker.show(root, 'lost', 'fixture'); time = 50; tracker.clear(root, 'recovered');
  expect(outcomes).toEqual([]);
  time = 100; tracker.show(root, 'lost', 'fixture'); time += 172800000; tracker.clear(root, 'recovered');
  expect(outcomes[0]?.durationMs).toBe(172800000);
});

test('refused delivery survives restart with immutable id and payload, then acknowledgement removes it', async () => {
  const device = storage(), first = new FailureOutbox(device), sent: AnalyticsBatch[] = [];
  expect(first.add('old-build', 'install', episode())).toBe(true);
  first.add('changed-build', 'install', { ...episode(), durationMs: 9999 });
  await first.flush(async batch => { sent.push(batch); return false; });
  const restarted = new FailureOutbox(device);
  expect(restarted.pending()).toHaveLength(1);
  await restarted.flush(async batch => { sent.push(batch); return true; });
  expect(sent[0]).toEqual(sent[1]);
  expect(sent[1]?.build).toBe('old-build');
  expect(sent[1]?.events[0]?.data).toEqual(episode());
  expect(new FailureOutbox(device).pending()).toEqual([]);
});

test('held acknowledgement cannot remove an episode or another document addition', async () => {
  const device = storage(), first = new FailureOutbox(device);
  first.add('build', 'install', episode());
  let acknowledge: (accepted: boolean) => void = () => { throw new Error('unbound acknowledgement'); };
  const acknowledgement = new Promise<boolean>(resolve => { acknowledge = resolve; });
  const pending = first.flush(async () => acknowledgement);
  await first.flush(async () => { throw new Error('must not send the in-flight id again'); });
  expect(new FailureOutbox(device).pending()).toHaveLength(1);
  new FailureOutbox(device).add('build', 'install', episode('episode-other'));
  acknowledge(true); await pending;
  expect(new FailureOutbox(device).pending().map(value => value.data.id)).toEqual(['episode-other']);
});

test('storage refusal is explicit and retains the live document copy; malformed outcomes are refused', async () => {
  const memory = new FailureOutbox(null);
  expect(memory.add('build', 'install', episode())).toBe(false);
  expect(memory.pending()).toHaveLength(1);
  await memory.flush(async () => { throw new Error('offline'); });
  expect(memory.pending()).toHaveLength(1);
  expect(memory.add('build', 'install', { ...episode('episode-invalid'), screen: 'https://private.example' })).toBe(false);
  expect(memory.pending()).toHaveLength(1);
});
