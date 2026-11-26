import { strict as assert } from 'node:assert';
import { fork } from 'node:child_process';
import { Agent, createServer, get as httpGet } from 'node:http';
import { test } from 'vitest';
import { childListener, databaseFront, listenLoopback, rigFront } from '../scripts/rig-listeners.mjs';

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

test('a retarget swaps backends with no downtime, and a pooled keep-alive connection never reaches the old one after the drain', async () => {
  const servers = [];
  const front = await rigFront();
  try {
    const ports = [];
    for (const name of ['old', 'new']) {
      const server = createServer((_request, response) => { response.end(name); }); servers.push(server);
      ports.push(await listenLoopback(server));
    }
    front.point(ports[0]);
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    /** @returns {Promise<string>} */
    const get = () => new Promise((resolve, reject) => {
      httpGet({ host: '127.0.0.1', port: front.port, agent }, response => { let body = ''; response.on('data', chunk => { body += String(chunk); }); response.on('end', () => { resolve(body); }); }).on('error', reject);
    });
    assert.equal(await get(), 'old');
    front.retarget(ports[1], 200);
    // a new connection reaches the new backend at once; after the drain the pooled one does too
    assert.equal(await fetch(`http://127.0.0.1:${front.port}`, { headers: { connection: 'close' } }).then(response => response.text()), 'new');
    await new Promise(resolve => { setTimeout(resolve, 400); });
    assert.equal(await get(), 'new');
    agent.destroy();
  } finally {
    await front.close();
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
  // the database on a loopback port: the full suite's TMPDIR is deep in the repo, past the Unix socket path limit
  const spare = createServer(), dbPort = await listenLoopback(spare); spare.close();
  const db = new PGlite(), socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: dbPort, maxConnections: 8 });
  await socket.start();
  const holder = createServer(), port = await listenLoopback(holder); holder.close();
  const front = await databaseFront(port, dbPort), clients = [];
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
    await front.close(); await socket.stop(); await db.close();
  }
}, 30_000);
