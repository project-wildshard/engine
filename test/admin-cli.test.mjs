// Meta QA-FEEDBACK-2026-11-23 row 6: the admin command's box calls, with no box and no ssh.
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect, test} from 'vitest';
import {adminToken, channelHeads, journalCommand, main, notifyCommand, notifyToken, revisionOf, tallyJournal} from '../src/scripts/admin.mjs';

const HASH = 'a'.repeat(64), OTHER = 'b'.repeat(64), TOKEN = ['planted', 'notify', 'value', '0123456789'].join('-');
const catalogue = {shards: [
  {slug: 'pine-hollow', live: {revision: 5, hash: HASH}, preview: {revision: 6, hash: OTHER}, channels: {staging: {raw: OTHER}}},
  {slug: 'sunscar-dunes', live: {revision: 1, hash: 'c'.repeat(64)}},
]};
const reply = (status, body = {}) => new Response(status === 200 ? JSON.stringify(body) : null, {status});
const journal = [
  '2026-11-23T19:05:50+00:00 box node[1]: cook worker on 127.0.0.1:8792',
  `2026-11-23T19:06:00+00:00 box node[1]: cook pine-hollow ${HASH.slice(0, 12)}: try 1 failed: R2 500`,
  `2026-11-23T19:07:00+00:00 box node[1]: cook pine-hollow ${HASH.slice(0, 12)}: cooked in 231.2 s, stale preparation: pine-hollow`,
  `2026-11-23T19:08:00+00:00 box node[1]: cook far-reach ${'d'.repeat(12)}: failed`,
  `2026-11-23T19:09:00+00:00 box node[1]: cook sunscar-dunes ${'c'.repeat(12)}: present`,
  `2026-11-23T19:10:00+00:00 box node[1]: poll 9b74e58cc927ce5aa4c1477ca554ab3daf00851d: 1 head(s) to cook, 0 new: far-reach dddddddddddd`,
].join('\n');

test('the journal tally keeps each head\'s last verdict and the build the cook names', () => {
  const tally = tallyJournal(journal);
  expect(tally.build).toBe('9b74e58cc927ce5aa4c1477ca554ab3daf00851d');
  expect(tally.started).toBe('2026-11-23T19:05:50+00:00');
  expect(tally.counts).toEqual({cooked: 1, present: 1, carried: 0, failed: 1});
  expect(tally.failed.map(head => head.slug)).toEqual(['far-reach']);
});

test('the journal is the current run only, and a recook wait reads only lines after its notice', () => {
  expect(journalCommand()).toMatch(/^journalctl _SYSTEMD_INVOCATION_ID="\$\(systemctl show -p InvocationID --value wildshard-cook\)"/u);
  expect(journalCommand(40, 1_700_000_000_500)).toMatch(/ --since @1700000000 -n 40$/u);
});

test('a notice is refused for a bad slug, hash or revision before anything connects', () => {
  expect(() => notifyCommand({slug: 'pine; reboot', hash: HASH, revision: 1})).toThrow(/slug/u);
  expect(() => notifyCommand({slug: 'pine-hollow', hash: 'abc', revision: 1})).toThrow(/hash/u);
  expect(() => notifyCommand({slug: 'pine-hollow', hash: HASH, revision: 0})).toThrow(/revision/u);
  const command = notifyCommand({slug: 'pine-hollow', hash: HASH, revision: 5});
  expect(command).toContain('-H @-');
  expect(command).toContain(`"shard":"pine-hollow","revision":5,"hash":"${HASH}"`);
  expect(command).toMatch(/http:\/\/127\.0\.0\.1:8792\/notify$/u);
});

test('the token comes from the environment or cook.env and never rides the command line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'admin-cli-'));
  try {
    writeFileSync(join(dir, 'cook.env'), `R2_BUCKET_PACKS=x\nCOOK_NOTIFY_TOKEN='${TOKEN}'\n`);
    expect(notifyToken({}, join(dir, 'cook.env'))).toBe(TOKEN);
    expect(() => notifyToken({}, join(dir, 'missing.env'))).toThrow(/no COOK_NOTIFY_TOKEN/u);
  } finally { rmSync(dir, {recursive: true, force: true}); }
  /** @type {{command: string, input?: string}[]} */
  const calls = [];
  let clock = 1_700_000_000_000;
  const run = (command, input) => {
    calls.push({command, input});
    if (command.includes('/notify')) return `{"queued":"${HASH}"}\n202`;
    return `2026-11-23T20:40:00+00:00 box node[1]: cook pine-hollow ${HASH.slice(0, 12)}: present`;
  };
  const out = await main(['recook', 'pine-hollow', HASH, '--wait', '60'], {run, env: {COOK_NOTIFY_TOKEN: TOKEN}, fetch: () => Promise.resolve(reply(200, catalogue)),
    now: () => clock, sleep: ms => { clock += ms; return Promise.resolve(); }});
  expect(out).toMatchObject({slug: 'pine-hollow', revision: 5, state: 'present'});
  expect(calls[0]?.input).toBe(`Authorization: Bearer ${TOKEN}\n`);
  for (const call of calls) expect(call.command).not.toContain(TOKEN);
  expect(calls[1]?.command).toContain(` --since @${String(Math.floor((1_700_000_000_000 - 5_000) / 1000))}`);
});

test('a refused notice is an error naming the cook\'s answer', async () => {
  await expect(main(['recook', 'pine-hollow', HASH, '--revision', '5'], {run: () => '{"error":"bad token"}\n401', env: {COOK_NOTIFY_TOKEN: TOKEN}}))
    .rejects.toThrow(/answered 401: \{"error":"bad token"\}/u);
});

test('a head the catalogue does not list needs --revision', async () => {
  expect(revisionOf(catalogue, 'pine-hollow', OTHER)).toBe(6);
  expect(revisionOf(catalogue, 'pine-hollow', 'e'.repeat(64))).toBeUndefined();
  await expect(main(['recook', 'pine-hollow', 'e'.repeat(64)], {run: () => '', fetch: () => Promise.resolve(reply(200, catalogue))}))
    .rejects.toThrow(/pass --revision/u);
});

test('status counts the channel\'s heads indexed for the cook\'s build', async () => {
  expect([...channelHeads(catalogue, 'staging').keys()]).toEqual([OTHER]);
  expect([...channelHeads(catalogue, 'production').keys()].sort()).toEqual([HASH, OTHER, 'c'.repeat(64)].sort());
  const fetch = url => Promise.resolve(String(url).endsWith('/api/catalogue') ? reply(200, catalogue) : reply(String(url).includes(HASH) ? 200 : 404));
  const run = command => command.includes('/health') ? '{"ok":true,"rows":3,"failed":1}' : journal;
  const out = await main(['status', 'production'], {run, fetch});
  expect(out).toMatchObject({channel: 'production', cook: {healthy: true, failed: 1, build: '9b74e58cc927ce5aa4c1477ca554ab3daf00851d', cooked: 1},
    failedHeads: [`far-reach ${'d'.repeat(12)}`], indexed: '1 of 3'});
  await expect(main(['status', 'prod'], {run, fetch})).rejects.toThrow(/usage/u);
});

test('probe and restart are box-ops\'s verbs, production restart still refused', async () => {
  const calls = [];
  await expect(main(['restart', 'production'], {run: command => { calls.push(command); return ''; }})).rejects.toThrow(/refused/u);
  expect(calls).toEqual([]);
});

test('format re-runs a channel move with the admin token, and refuses a bad channel or format first', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'admin-cli-'));
  try {
    writeFileSync(join(dir, 'api.env'), `DATABASE_URL=x\nADMIN_TOKEN=${TOKEN}\n`);
    expect(adminToken({}, join(dir, 'api.env'))).toBe(TOKEN);
  } finally { rmSync(dir, {recursive: true, force: true}); }
  /** @type {{url: string, init?: RequestInit}[]} */
  const calls = [];
  const fetch = (url, init) => { calls.push({url: String(url), init}); return Promise.resolve(new Response(JSON.stringify({queued: 3}), {status: 202})); };
  await expect(main(['format', 'prod', '0.1.0.4'], {fetch, env: {ADMIN_TOKEN: TOKEN}})).rejects.toThrow(/usage/u);
  await expect(main(['format', 'staging', '0.1.0.4; drop'], {fetch, env: {ADMIN_TOKEN: TOKEN}})).rejects.toThrow(/usage/u);
  expect(calls).toEqual([]);
  expect(await main(['format', 'staging', '0.1.0.4', '--drop', 'a,b'], {fetch, env: {ADMIN_TOKEN: TOKEN}})).toEqual({channel: 'staging', format: '0.1.0.4', status: 202, answer: {queued: 3}});
  expect(calls[0]?.url).toBe('https://api.wildshard.io/api/channels/staging/format');
  expect(calls[0]?.init?.method).toBe('PUT');
  expect(calls[0]?.init?.body).toBe('{"format":"0.1.0.4","drop":["a","b"]}');
  const refused = () => Promise.resolve(new Response('{"error":"api-server is at format 0.1.0.4; move its format pin first"}', {status: 409}));
  await expect(main(['format', 'staging', '9999.0'], {fetch: refused, env: {ADMIN_TOKEN: TOKEN}})).rejects.toThrow(/answered 409: .*format pin first/u);
});
