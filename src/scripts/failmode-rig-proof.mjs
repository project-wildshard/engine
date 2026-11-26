// FM3a native database identity/lifetime proof; explicit binary input, no installed service.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { confirmPostgres, freeFixturePorts, ownedPostgres } from './online-rig-owned.mjs';

const bin = process.argv[2];
if (bin === undefined) throw new Error('failmode-rig-proof <directory containing postgres/initdb/pg_ctl>');
const base = resolve('tmp/codex-pagesize'); mkdirSync(base, { recursive: true });
const work = mkdtempSync(join(base, 'native-rig-proof-'));
const probe = createServer();
const listening = once(probe, 'listening', {signal: AbortSignal.timeout(10_000)});
probe.listen(0, '127.0.0.1'); await listening;
const address = probe.address();
if (address === null || typeof address === 'string') throw new Error('No owned fixture port');
const port = address.port;
await probe[Symbol.asyncDispose]();
try {
  await freeFixturePorts([port]);
  const pg = ownedPostgres({bin, data: join(work, 'data'), port});
  const client = new Client({host: '127.0.0.1', port, user: 'postgres', database: 'postgres'});
  try {
    await client.connect(); await confirmPostgres(client, pg.data);
    await client.query('create database failmode_owned');
    const result = await client.query("select datname from pg_database where datname='failmode_owned'");
    assert.equal(result.rows[0].datname, 'failmode_owned');
    await assert.rejects(confirmPostgres(client, work), /unowned Postgres/u);
  } finally { try { await client.end(); } finally { pg.close(); } }
  await freeFixturePorts([port]);
  console.log('PASS fresh native Postgres, connected identity, foreign-data refusal and drained port');
} finally { rmSync(work, {recursive: true, force: true}); }
