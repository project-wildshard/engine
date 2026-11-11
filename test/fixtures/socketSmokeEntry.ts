// Portable Math before anything: a module body may read Math, and this is how every server entry starts (E7.2).
import '@wildshard/engine/core/portableMathFirst';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { NetClient } from '../../src/client/engine/net/client';
import { Redial } from '../../src/client/engine/net/redial';
import { WebSocketTransport } from '../../src/client/engine/net/webSocketTransport';
import { NetRoom } from '../../src/server/engine/net/room';
import { ServerClock } from '../../src/server/engine/net/serverClock';
import { SimNetWorld } from '../../src/server/engine/net/simWorld';
import { createSimHost } from '../../src/server/engine/sim';
import { SOCKET_SERVER_OPTIONS, SocketTransport } from '../../src/server/host/dedicated/socketTransport';
import { loadRapier } from '../../src/shared/engine/physics/rapier';
import { SIM_LEVEL } from './sim-level/level';

// E7.1: a real run: this bundled, on plain Node 24, with no test runner, on real time. `scripts/socket-smoke.mjs` builds it as E7.2's target will.
const seconds = Number(process.argv[2] ?? 4), rapier = await loadRapier(readFileSync(process.argv[3] ?? 'public/assets/physics/rapier.wasm'));
const host = createSimHost(SIM_LEVEL, { rapier }), bot = host.addPlayer('bot:1', { x: 3, y: 0, z: 0 }), world = new SimNetWorld(host);
const room = new NetRoom({ world, step: inputs => { const commands = new Map<string, NetCommand>(); for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command); host.step(commands); } });
room.open();
const server = new WebSocketServer({ host: '127.0.0.1', port: 0, ...SOCKET_SERVER_OPTIONS });
await new Promise<void>(resolve => { server.once('listening', resolve); });
const ends: SocketTransport[] = [];
server.on('connection', socket => { const end = new SocketTransport(socket); ends.push(end); room.join(end, world.playerOf(bot.id)); });
const url = `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}`, first = new WebSocketTransport(url), client = new NetClient(first), states: string[] = [];
const redial = new Redial({ client, transport: first, dial: () => new WebSocketTransport(url), onState: state => { states.push(state); } });
client.hello();
let cut = false, ticks = 0, sent = 0;
const clock = new ServerClock({ now: () => performance.now(), wait: (ms, run) => { const timer = setTimeout(run, ms); return () => { clearTimeout(timer); }; }, step: () => { room.tick(); ticks++; } });
const start = bot.position.clone(), started = performance.now();
clock.start();
await new Promise<void>(resolve => {
  const beat = setInterval(() => {
    const now = performance.now();
    if (client.latest !== null) { client.command({ steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }); sent++; client.flush(); }
    if (!cut && now - started > seconds * 500) { cut = true; for (const socket of server.clients) socket.terminate(); }
    if (now - started > seconds * 1000) { clearInterval(beat); resolve(); }
  }, 16);
});
const { rttMs } = ends.at(-1)?.stats ?? { rttMs: -1 };
console.log(JSON.stringify({ node: process.version, portableMath: !Math.sin.toString().includes('[native code]'), sin1: Math.sin(1), ticks, ticksPerSecond: Math.round(ticks / seconds), sent, moved: Number(bot.position.distanceTo(start).toFixed(2)), rttMs: Number(rttMs.toFixed(2)), rejoins: ends.length - 1, states, dropped: client.dropped, refused: room.stats.refused }));
clock.pause(); redial.dispose(); client.dispose(); room.dispose(); host.dispose();
for (const socket of server.clients) socket.terminate();
server.close(); process.exit(0);
