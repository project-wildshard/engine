import { strict as assert } from 'node:assert';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'vitest';
import { childListener, listenLoopback, rigFront } from '../../scripts/rig-listeners.mjs';

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
