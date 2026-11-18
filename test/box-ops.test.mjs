// Meta MINI-AUTONOMY MA7a: the box workflows' guards and the probe's arithmetic, with no box and no ssh.
import {expect, test} from 'vitest';
import {main, probeQueries, promCommand, restartCommand, shq, summarize} from '../scripts/box-ops.mjs';

const ok = result => ({status: 'success', data: {resultType: 'vector', result}});
const sample = (labels, value) => ({metric: labels, value: [1, String(value)]});
const answers = {
  tick: ok([sample({worker: '0'}, 0.004), sample({worker: '1'}, 0.009)]),
  rss: ok([sample({}, 1024 * 2 ** 20)]),
  heapSlope: ok([sample({}, 1024)]),
};

test('production restart is refused before anything connects', () => {
  const calls = [];
  expect(() => restartCommand('production')).toThrow(/refused/u);
  expect(() => main(['restart', 'production'], command => calls.push(command))).toThrow(/refused/u);
  expect(() => main(['restart', 'staging; reboot'], command => calls.push(command))).toThrow(/refused/u);
  expect(calls).toEqual([]);
});

test('staging restart names only the staging unit and must end active', () => {
  expect(restartCommand('staging')).toContain('wildshard-server@staging');
  expect(restartCommand('staging')).not.toContain('production');
  // Type=simple returns at fork: the state is read only after a settle, and printed even when not active.
  expect(restartCommand('staging')).toMatch(/restart wildshard-server@staging && sleep 20 && \{ systemctl is-active wildshard-server@staging \|\| true; \}$/u);
  expect(main(['restart', 'staging'], () => 'active\n')).toEqual({channel: 'staging', restarted: true, state: 'active'});
  expect(() => main(['restart', 'staging'], () => 'failed\n')).toThrow(/'failed'/u);
});

test('the probe reads the worst worker, RSS and heap slope for one channel', () => {
  const summary = summarize('staging', answers);
  expect(summary).toMatchObject({channel: 'staging', tickP95MaxMs: 9, tickP95Worker: '1', workers: 2, rssMiB: 1024, heapSlopeKiBPerMin: 60, tickOk: true, rssOk: true});
  expect(summarize('staging', {...answers, tick: ok([sample({worker: '0'}, 0.02)])}).tickOk).toBe(false);
  expect(summarize('staging', {...answers, rss: ok([sample({}, 4 * 2 ** 30)])}).rssOk).toBe(false);
  expect(summarize('production', {...answers, rss: ok([sample({}, 4 * 2 ** 30)])}).rssOk).toBe(true);
});

test('a missing series fails the probe rather than reading as zero', () => {
  expect(() => summarize('staging', {...answers, heapSlope: ok([])})).toThrow(/no tick, RSS or heap/u);
  expect(() => summarize('staging', {...answers, tick: {status: 'error'}})).toThrow(/success/u);
});

test('queries stay inside one known channel and quote safely for the remote shell', () => {
  expect(() => probeQueries('prod"} or vector(1)')).toThrow(/unknown channel/u);
  for (const query of Object.values(probeQueries('production'))) expect(query).toContain('channel="production"');
  expect(shq("a'b")).toBe(`'a'\\''b'`);
  expect(promCommand('up{a="b"}')).toBe(`curl -s -m 15 --get --data-urlencode 'query=up{a="b"}' 127.0.0.1:9090/api/v1/query`);
});

test('probe runs one read-only loopback curl per query', () => {
  const calls = [];
  const replies = [answers.tick, answers.rss, answers.heapSlope];
  const summary = main(['probe', 'staging'], command => {
    calls.push(command);
    return JSON.stringify(replies[calls.length - 1]);
  });
  expect(summary.channel).toBe('staging');
  expect(calls).toHaveLength(3);
  for (const command of calls) expect(command).toMatch(/^curl -s -m 15 --get .* 127\.0\.0\.1:9090\/api\/v1\/query$/u);
});
