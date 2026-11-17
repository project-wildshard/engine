import { strict as assert } from 'node:assert';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'vitest';
import { childListener, databaseFront, listenLoopback, rigFront } from '../../scripts/rig-listeners.mjs';

test('two owned fronts forward actual HTTP across child replacements', async () => {
  const servers = [], fronts = [];
  try {
    for (let index = 0; index < 2; index++) fronts.push(await rigFront());
    assert.notEqual(fronts[0].port, fronts[1].port);
    for (let index = 0; index < 3; index++) {
      const server = createServer((_request, response) => { response.end(String(index)); }); servers.push(server);
      const port = await listenLoopback(server); fronts[index % 2].point(port);
      assert.equal(await (await fetch(`http://127.0.0.1:${fronts[index % 2].port}`, { headers: { connection: 'close' } })).text(), String(index));
    }
    fronts[0].clear();
    await assert.rejects(fetch(`http://127.0.0.1:${fronts[0].port}`));
    assert.equal(await (await fetch(`http://127.0.0.1:${fronts[1].port}`)).text(), '1');
  } finally {
    await Promise.all(fronts.map(front => front.close()));
    await Promise.all(servers.map(async server => { server.closeAllConnections(); await server[Symbol.asyncDispose](); }));
  }
});

test('a child exit is refused without waiting for a forged readiness message', async () => {
  const child = fork('-e', ['process.send({kind:"world-ready",pid:process.pid+1,port:4567});process.exit(0)'], { silent: true, execArgv: [] });
  await assert.rejects(childListener(child, 'world-ready'), /exited/);
});

test('a live owner keeps its occupied port when another listener is refused', async () => {
  const foreign = createServer((_request, response) => { response.end('foreign'); }), contender = createServer();
  const port = await listenLoopback(foreign);
  try {
    await assert.rejects(listenLoopback(contender, port), { code: 'EADDRINUSE' });
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'foreign');
  } finally { foreign.closeAllConnections(); await foreign[Symbol.asyncDispose](); }
});

test('FM8s: the database front holds queries without failing them, then refuses, then passes again', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), { PGLiteSocketServer } = await import('@electric-sql/pglite-socket'), { Client } = await import('pg');
  const { mkdtempSync, rmSync } = await import('node:fs'), { join } = await import('node:path'), { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'dbfront-')), db = new PGlite(), socket = new PGLiteSocketServer({ db, path: join(dir, 'pg.sock'), maxConnections: 8 });
  await socket.start();
  const holder = createServer(), port = await listenLoopback(holder); holder.close();
  const front = await databaseFront(port, join(dir, 'pg.sock')), clients = [];
  const open = async () => { const client = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', connectionTimeoutMillis: 2000 }); client.on('error', () => undefined); clients.push(client); await client.connect(); return client; };
  try {
    const first = await open();
    assert.equal((await first.query('select 1 as one')).rows[0].one, 1);
    front.fault('hold');
    let landed = false;
    const waiting = first.query('select 2 as two').then(result => { landed = true; return result; });
    // a connection opened while held still opens: a stalled database is late, not down
    const second = await open();
    const alsoWaiting = second.query('select 3 as three');
    await new Promise(resolve => { setTimeout(resolve, 300); });
    assert.equal(landed, false);
    assert.ok(front.stats.heldBytes > 0);
    front.fault('pass');
    assert.equal((await waiting).rows[0].two, 2);
    assert.equal((await alsoWaiting).rows[0].three, 3);
    front.fault('refuse');
    await assert.rejects(first.query('select 4'));
    await assert.rejects(open());
    assert.ok(front.stats.refused >= 1);
    front.fault('pass');
    assert.equal((await (await open()).query('select 5 as five')).rows[0].five, 5);
  } finally {
    await Promise.all(clients.map(client => client.end().catch(() => undefined)));
    await front.close(); await socket.stop(); await db.close(); rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
