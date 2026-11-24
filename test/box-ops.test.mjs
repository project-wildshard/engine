// Meta MINI-AUTONOMY MA7a/MA7c: the box workflows' guards, the probe's arithmetic and the box gate, with no box and no ssh.
import {Buffer} from 'node:buffer';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterAll, expect, test} from 'vitest';
import {GATE, GATE_MISSING, gateProbeCommand, gateRestartCommand, main, playerQueries, probeQueries, promCommand, restartCommand, shq, summarize, summarizePlayers, throughGate} from '../scripts/box-ops.mjs';

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

test('probe sends each query to the gate as one hex word', () => {
  const calls = [];
  const replies = [answers.tick, answers.rss, answers.heapSlope];
  const summary = main(['probe', 'staging'], command => {
    calls.push(command);
    return JSON.stringify(replies[calls.length - 1]);
  });
  expect(summary.channel).toBe('staging');
  expect(calls).toHaveLength(3);
  const queries = Object.values(probeQueries('staging'));
  calls.forEach((command, index) => {
    const [gate, verb, word, ...rest] = command.split(' ');
    expect([gate, verb, rest]).toEqual([GATE, 'probe', []]);
    expect(word).toMatch(/^(?:[0-9a-f]{2})+$/u);
    expect(Buffer.from(word, 'hex').toString('utf8')).toBe(queries[index]);
  });
});

test('a box with no gate yet falls back to the plain command; a refusal never does', () => {
  const missing = Object.assign(new Error('ssh exited 127'), {status: GATE_MISSING});
  const calls = [];
  expect(main(['restart', 'staging'], command => {
    calls.push(command);
    if (command.startsWith(GATE)) throw missing;
    return 'active\n';
  })).toEqual({channel: 'staging', restarted: true, state: 'active'});
  expect(calls).toEqual([`${GATE} restart-staging`, restartCommand('staging')]);
  const refused = Object.assign(new Error('ssh exited 2'), {status: 2});
  expect(() => throughGate(command => { calls.push(command); throw refused; }, 'gated', 'plain')).toThrow(/exited 2/u);
  expect(calls.at(-1)).toBe('gated');
  expect(() => gateRestartCommand('production')).toThrow(/refused/u);
});

// The gate itself, run by bash with curl, sudo, systemctl and sleep stubbed to print their argv.
mkdirSync('tmp/box-gate', {recursive: true});
const scratch = mkdtempSync(resolve('tmp/box-gate/run-'));
afterAll(() => rmSync(scratch, {recursive: true, force: true}));
for (const name of ['curl', 'sudo', 'systemctl', 'sleep']) {
  writeFileSync(join(scratch, name), `#!/bin/sh\nprintf '%s\\n' "${name} $*"\n`, {mode: 0o755});
}
/** @param {string | undefined} ask @param {string[]} [args] */
function gate(ask, args = []) {
  const env = {PATH: `${scratch}:/usr/bin:/bin`, ...(ask === undefined ? {} : {SSH_ORIGINAL_COMMAND: ask})};
  const done = spawnSync('bash', [resolve('scripts/vps/wildshard-box-gate'), ...args], {encoding: 'utf8', env});
  return {status: done.status, out: done.stdout.trim(), err: done.stderr};
}

test('the gate runs a probe as one loopback curl and restarts only staging', () => {
  const query = probeQueries('production').rss;
  const word = gateProbeCommand(query).split(' ').at(-1);
  expect(gate(`probe ${word}`)).toMatchObject({status: 0, out: `curl -s -m 15 --get --data-urlencode query=${query} http://127.0.0.1:9090/api/v1/query`});
  expect(gate(gateProbeCommand(query)).out).toBe(gate(`probe ${word}`).out);
  expect(gate(undefined, ['wildshard-box-gate', 'probe', word]).status).toBe(0);
  const shelly = 'up{a="$(id)"} or `x` \\x41 \'q\'';
  expect(gate(gateProbeCommand(shelly)).out, 'the query reaches curl as bytes, never read by a shell').toBe(`curl -s -m 15 --get --data-urlencode query=${shelly} http://127.0.0.1:9090/api/v1/query`);
  expect(gate(gateRestartCommand('staging'))).toMatchObject({status: 0, out: 'sudo -n /usr/bin/systemctl restart wildshard-server@staging\nsleep 20\nsystemctl is-active wildshard-server@staging'});
});

test('the gate refuses a production restart, a shell line and anything else before running it', () => {
  const word = gateProbeCommand('up').split(' ').at(-1);
  for (const ask of ['sudo -n /usr/bin/systemctl restart wildshard-server@production', 'systemctl restart wildshard-server@production',
    'restart-production', 'restart-staging now', `probe ${word}; reboot`, `probe ${word} extra`, 'probe $(id)', 'probe abc', 'id', '', 'bash']) {
    const result = gate(ask);
    expect(result.status, ask).toBe(2);
    expect(result.out, ask).toBe('');
    expect(result.err, ask).toMatch(/^refused: /u);
  }
});

test('MW2: players reads seats now and the fewest over the window, through the gate', () => {
  const asked = [];
  const answer = value => JSON.stringify({status: 'success', data: {result: [{metric: {}, value: [0, String(value)]}]}});
  const out = main(['players', 'staging'], command => { asked.push(command); return answer(asked.length === 1 ? 12 : 11); });
  expect(out).toEqual({channel: 'staging', players: 12, fewestOverWindow: 11, window: '10m'});
  expect(asked).toEqual([gateProbeCommand(playerQueries('staging').now), gateProbeCommand(playerQueries('staging').fewest)]);
  expect(() => summarizePlayers('staging', {now: {status: 'success', data: {result: []}}, fewest: {status: 'success', data: {result: []}}})).toThrow(/no player series/u);
  expect(() => playerQueries('prod')).toThrow(/unknown channel/u);
});
