import { test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the original Node strict assertion semantics in this Node-only tool regression.
import assert from 'node:assert/strict';
import { soakInspector } from '../../../scripts/soak/inspector.mjs';

class Socket {
  static current;
  constructor(url, options) { this.listeners = new Map(); this.sent = []; this.options = options; Socket.current = this; queueMicrotask(() => { this.emit('open'); }); }
  on(type, listener) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  once(type, listener) { const wrapped = (...args) => { this.listeners.get(type).delete(wrapped); listener(...args); }; this.on(type, wrapped); }
  emit(type, value) { for (const listener of this.listeners.get(type) ?? []) listener(value); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.emit('close'); }
  message(value) { this.emit('message', JSON.stringify(value)); }
  reply(value) { this.message({ method: 'Target.dispatchMessageFromTarget', params: { message: JSON.stringify(value) } }); }
}
test('one target-aware connection carries passive events, scalar evaluation and heap data; listeners retire', async () => {
  const driver = soakInspector('ws://fixture', Socket); await driver.opened;
  const socket = Socket.current; assert.equal(socket.options.maxPayload, 512 * 1024 * 1024);
  socket.message({ method: 'Target.targetCreated', params: { targetInfo: { type: 'page', targetId: 'page-1' } } });
  const events = [], off = driver.on('Memory.trackingUpdate', value => { events.push(value); });
  const evalPromise = driver.evaluate('1+2'), sent = socket.sent.at(-1), inner = JSON.parse(sent.params.message);
  assert.equal(sent.params.targetId, 'page-1'); socket.message({ id: sent.id, result: {} });
  socket.reply({ method: 'Memory.trackingUpdate', params: { event: { timestamp: 1 } } });
  socket.reply({ id: inner.id, result: { result: { value: 3 } } }); assert.equal(await evalPromise, 3);
  off(); socket.reply({ method: 'Memory.trackingUpdate', params: { event: { timestamp: 2 } } }); assert.equal(events.length, 1);
  socket.message({ method: 'Target.didCommitProvisionalTarget', params: { newTargetId: 'page-2' } });
  const heapPromise = driver.send('Heap.snapshot'), heapSent = socket.sent.at(-1);
  assert.equal(heapSent.params.targetId, 'page-2'); socket.reply({ id: JSON.parse(heapSent.params.message).id, result: { snapshotData: 'large heap' } });
  assert.equal((await heapPromise).snapshotData, 'large heap'); driver.close();
});
test('protocol and socket failures reject pending work rather than hanging for a heap deadline', async () => {
  const driver = soakInspector('ws://fixture', Socket); await driver.opened; const socket = Socket.current;
  const unsupported = driver.send('Memory.enable'); socket.message({ id: socket.sent.at(-1).id, error: { message: 'unsupported' } });
  await assert.rejects(unsupported, /unsupported/);
  const pending = driver.send('Heap.snapshot'); driver.close(); await assert.rejects(pending, /Inspector closed/);
});
