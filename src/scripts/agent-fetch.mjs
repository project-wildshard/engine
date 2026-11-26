import { markedFetch, markedSocket } from './agent-requests.mjs';

export { markedFetch, markedSocket } from './agent-requests.mjs';

const installed = Symbol.for('wildshard.agent-network');

if (Reflect.get(globalThis, installed) !== true) {
  Reflect.set(globalThis, installed, true);
  globalThis.fetch = markedFetch(globalThis.fetch);
  if (typeof globalThis.WebSocket === 'function') globalThis.WebSocket = markedSocket(globalThis.WebSocket);
}
