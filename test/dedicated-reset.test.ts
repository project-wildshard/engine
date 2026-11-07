// oxlint-disable-next-line import/no-nodejs-modules -- Run the real gateway in an isolated process.
import { spawn } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- WebSocket's public per-handshake nonce.
import { randomBytes } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Await process lifecycle.
import { once } from 'node:events';
// oxlint-disable-next-line import/no-nodejs-modules -- Disposable bundled fixture.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Send real TCP resets.
import { connect } from 'node:net';
// oxlint-disable-next-line import/no-nodejs-modules -- Checkout-relative scratch.
import { resolve as absolute, join } from 'node:path';
import { build } from 'esbuild';
import { expect, test } from 'vitest';

const HANDSHAKE = `Host: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n`;
test('TCP resets on refused upgrades cannot end the gateway process', { timeout: 9000 }, async () => {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(absolute('tmp/reset-')), file = join(root, 'door.mjs');
  await build({ stdin: { contents: `import {createServer} from 'node:http'; import {World} from './src/server/host/dedicated/world'; import {memoryPlayerSaves} from './src/server/host/dedicated/playerSaves';
const world=await World.open({build:'test',cells:[],workers:1,seats:1,secret:'test',saves:memoryPlayerSaves(),boot:()=>{throw Error('no worker')},log:()=>{},crashed:()=>{},restart:()=>{}});
const server=createServer((q,r)=>r.end('alive'));server.on('upgrade',(q,s,h)=>world.upgrade(q,s,h));server.listen(0,'127.0.0.1',()=>console.log(server.address().port));`, resolveDir: process.cwd(), loader: 'ts' }, outfile: file, bundle: true, platform: 'node', format: 'esm', external: ['pg-native'], plugins: [{ name: 'rapier', setup: bundle => {
    bundle.onResolve({ filter: /^\.\/rapier_wasm3d(\.js)?$/ }, () => ({ path: absolute('src/server/engine/physics/rapierBindings.ts') }));
  } }], banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" } }).catch((error: unknown) => { rmSync(root, { recursive: true, force: true }); throw error; });
  const child = spawn(process.execPath, [file]); let errors = ''; child.stderr.on('data', (bytes: Buffer) => { errors += bytes.toString(); });
  try {
    const port = await new Promise<number>((resolve, reject) => { child.stdout.once('data', (bytes: Buffer) => { resolve(Number(bytes.toString().trim())); }); child.once('error', reject); });
    for (const path of ['/wrong', '/']) for (let index = 0; index < 24; index++) {
      if (child.exitCode !== null) break;
      await new Promise<void>(resolve => {
        const socket = connect(port, '127.0.0.1'); socket.on('error', () => undefined); socket.once('close', () => { resolve(); });
        socket.once('connect', () => { socket.write(`GET ${path} HTTP/1.1\r\n${HANDSHAKE}\r\n`); });
        socket.once('data', () => { socket.resetAndDestroy(); });
      });
    }
    await new Promise<void>(resolve => { setTimeout(resolve, 30); });
    expect(child.exitCode, errors).toBeNull();
    expect(await (await fetch(`http://127.0.0.1:${String(port)}/health`)).text()).toBe('alive');
  } finally { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } rmSync(root, { recursive: true, force: true }); }
});
