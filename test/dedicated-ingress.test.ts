import { expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { MAX_CLIENT_MESSAGES } from '../src/server/engine/net/room';
import { pumpSocket, SeatTransport } from '../src/server/host/dedicated/socketPump';
import { socketBench } from './fixtures/socketBench';

test('ready controls share a bounded gateway receive budget', async () => {
  const bench = await socketBench({ now: () => 0 }), socket = new WebSocket(bench.url), end = await bench.accepted();
  try {
    await new Promise<void>(resolve => { socket.once('open', resolve); });
    let controls = 0;
    end.onControl(() => { controls++; });
    for (let index = 0; index < 20_000; index++) socket.send(Buffer.from([5]));
    await new Promise<void>(resolve => { setTimeout(resolve, 100); });
    expect(controls).toBeLessThanOrEqual(MAX_CLIENT_MESSAGES);
    expect(end.isOpen).toBe(false);
  } finally { socket.terminate(); await bench.close(); }
});


test('a socket pump carries an already observed close to its worker', { timeout: 1000 }, async () => {
  const bench = await socketBench(), { server } = await bench.link(), { port1, port2 } = new MessageChannel(), seat = new SeatTransport(port2);
  try {
    server.close('stalled');
    const ended = new Promise<string>(resolve => { seat.onClose(resolve); });
    pumpSocket(server, port1);
    expect(await ended).toBe('stalled');
  } finally { seat.close(); port1.close(); port2.close(); await bench.close(); }
});

test('protocol pings cannot bypass the gateway budget before hello', async () => {
  const bench = await socketBench({ now: () => 0 }), socket = new WebSocket(bench.url), end = await bench.accepted();
  try {
    await new Promise<void>(resolve => { socket.once('open', resolve); }); let pongs = 0;
    socket.on('pong', () => { pongs++; });
    for (let index = 0; index < 20_000; index++) socket.ping();
    await new Promise<void>(resolve => { setTimeout(resolve, 100); });
    expect(pongs).toBeLessThanOrEqual(MAX_CLIENT_MESSAGES); expect(end.isOpen).toBe(false);
  } finally { socket.terminate(); await bench.close(); }
});
