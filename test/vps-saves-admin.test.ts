import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
// oxlint-disable-next-line import/no-nodejs-modules -- The real helper and the real psql; spawnSync would block the socket server.
import { execFile, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { openPglite } from './fixtures/pgliteDatabase';

// QA 11-15 row 24: `wildshard-config saves`, the agents' own way to clear a test or bot player from a box's saves database.
// It runs here as the developer (its test switches never work as root), on the real migrations in PGlite, through the real
// psql over pglite-socket, so the SQL is the box's. The logger stand-in echoes what the box journal would get.
const CONFIG = resolve('src/scripts/vps/wildshard-config');
const psqlThere = spawnSync('psql', ['--version'], { encoding: 'utf8' }).status === 0;
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

const PLAYERS = [['device:r13', 'r13pine'], ['device:agent', 'Agent W 4f2a A'], ['device:bot', 'Bot'], ['device:jake', 'Jake1'],
  ['device:guest', 'Guest'], ['device:jimmy', 'jimmy']] as const;

async function box() {
  const held = await openPglite(), server = new PGLiteSocketServer({ db: held.pglite, port: 0, host: '127.0.0.1' });
  await server.start();
  closers.push(async () => { await server.stop(); await held.close(); });
  await migrate(held);
  for (const [at, [id, name]] of PLAYERS.entries()) {
    await held.query('insert into player (id, name, created_at) values ($1, $2, $3)', [id, name, new Date(Date.UTC(2026, 10, 15, 12, at))]);
    await held.query('insert into player_save (player_id, epoch, shard, revision, build, save_version, seq, reason, doc) values ($1, 0, $2, 1, $3, 1, 1, $4, $5)',
      [id, 'driftwood-isle', 'b', 'test', '{}']);
    await held.query('insert into player_place (player_id, epoch, cell, reason) values ($1, 0, $2, $3)', [id, 'driftwood-isle', 'test']);
  }
  await held.query("insert into ledger_receipt (player_id, epoch, shard, serial, fact_id, grant_kind, name, amount) values ('device:r13', 0, 'driftwood-isle', 1, 'a', 'coins', 'coins', 1)");
  const { port } = server as unknown as { port: number }, url = new URL(`postgresql://127.0.0.1:${String(port)}/postgres`);
  url.username = 'postgres'; url.searchParams.set('sslmode', 'disable');
  const run = async (...args: string[]) => await new Promise<{ status: number; out: string }>(done => {
    execFile('python3', [CONFIG, 'saves', ...args], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', WILDSHARD_CONFIG_TEST_ROOT: '/nonexistent',
      WILDSHARD_CONFIG_TEST_PSQL: `psql ${url.href}`, WILDSHARD_CONFIG_TEST_LOGGER: '/bin/echo', SUDO_USER: 'wildshard-agent' } },
    (error, stdout, stderr) => { done({ status: typeof error?.code === 'number' ? error.code : 0, out: stdout + stderr }); });
  });
  const save = async (id: string, revision: number, doc: unknown) => await held.query('update player_save set revision = $2, doc = $3 where player_id = $1', [id, revision, JSON.stringify(doc)]);
  const ids = async () => (await held.pglite.query<{ id: string }>('select id from player order by id')).rows.map(row => row.id);
  const rows = async (table: string) => (await held.pglite.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]?.n;
  return { run, ids, rows, save };
}

test.skipIf(!psqlThere)('saves list prints each player\'s id, name and created_at, oldest first', async () => {
  const { run } = await box();
  const listed = await run('list', '--production');
  expect(listed.status).toBe(0);
  expect(listed.out.trim().split('\n')).toEqual(PLAYERS.map(([id, name], at) => `${id}  ${name}  2026-11-15T12:0${String(at)}:00Z`));
});

test.skipIf(!psqlThere)('delete-test is a dry run by default and refuses a real player, a missing one and a bad id', async () => {
  const { run, ids, rows } = await box();
  const dry = await run('delete-test', 'device:r13', 'device:agent', 'device:bot');
  expect(dry.status).toBe(0);
  expect(dry.out).toContain("would   saves_staging device:r13 'r13pine': ledger_receipt 1, player_place 1, player_save 1 and its player row");
  expect(dry.out).toContain('dry run: nothing deleted');
  for (const [args, why] of [
    [['device:r13', 'device:jake'], "not a test or bot name, so refused: device:jake ('Jake1')"],
    [['device:guest', '--yes'], "refused: device:guest ('Guest')"],
    [['device:jimmy', '--yes'], "refused: device:jimmy ('jimmy')"],
    [['device:nobody', '--yes'], 'no player device:nobody'],
    [["device:r13'; drop table player; --", '--yes'], 'is not a player id'],
    [['device:r13', 'device:r13'], 'none twice'],
    [[], 'name 1 to 50 player ids'],
  ] as const) {
    const refused = await run('delete-test', ...args);
    expect(refused.status, args.join(' ')).toBe(1);
    expect(refused.out, args.join(' ')).toContain(why);
  }
  expect(await ids()).toHaveLength(6);
  expect([await rows('player_save'), await rows('player_place'), await rows('ledger_receipt')]).toEqual([6, 6, 1]);
});

test.skipIf(!psqlThere)('delete-test --yes deletes every player_id row and the player in one go, logs it, and keeps the rest', async () => {
  const { run, ids, rows } = await box();
  const done = await run('delete-test', 'device:r13', 'device:agent', 'device:bot', '--yes', '--production');
  expect(done.status, done.out).toBe(0);
  expect(done.out).toContain('-t wildshard-saves -p auth.notice -- saves delete-test saves_production by wildshard-agent: '
    + "device:r13='r13pine' device:agent='Agent W 4f2a A' device:bot='Bot' (ledger_receipt 1, player_place 3, player_save 3, player 3)");
  expect(done.out).toContain('ok      saves_production deleted ledger_receipt 1, player_place 3, player_save 3, player 3');
  expect(await ids()).toEqual(['device:guest', 'device:jake', 'device:jimmy']);
  expect([await rows('player_save'), await rows('player_place'), await rows('ledger_receipt')]).toEqual([3, 3, 0]);
  expect((await run('delete-test', 'device:r13', '--yes')).out).toContain('no player device:r13');
});

test.skipIf(!psqlThere)('saves worn counts staging worn-skin keys per shard, revision, slot and skin, with no player id', async () => {
  const { run, save } = await box();
  // FORMAT-PRUNE FP22c: one map as JSON, one inside a JSON string (a page's storage copy), and one already on a declared key
  await save('device:r13', 13, { keys: { skins: { v: 1, data: { owned: ['warden', 'ironhide'], worn: { crossbow: 'warden', rifle: 'ironhide' } } } } });
  await save('device:jake', 13, { 'pine-hollow': JSON.stringify({ keys: { skins: { v: 1, data: { owned: ['warden'], worn: { crossbow: 'warden' } } } } }) });
  await save('device:bot', 17, { keys: { skins: { v: 1, data: { owned: ['warden'], worn: { 'declared.weapon.crossbow': 'warden' } } } } });
  const worn = await run('worn');
  expect(worn.status).toBe(0);
  expect(worn.out.trim().split('\n')).toEqual(['saves_staging: 6 save rows; worn keys (shard revision slot skin count):',
    '  driftwood-isle  13  crossbow  warden  2', '  driftwood-isle  13  rifle  ironhide  1', '  driftwood-isle  17  declared.weapon.crossbow  warden  1']);
  expect(worn.out).not.toContain('device:');
  expect((await run('worn', '--production')).out).toContain('saves worn reads staging only');
});

test('saves refuses a verb it does not know', async () => {
  const run = await new Promise<string>(done => {
    execFile('python3', [CONFIG, 'saves', 'drop'], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', WILDSHARD_CONFIG_TEST_ROOT: '/nonexistent' } },
      (_error, stdout, stderr) => { done(stdout + stderr); });
  });
  expect(run).toContain('usage: wildshard-config saves list');
});
