import { afterEach, expect, test } from 'vitest';
import { startInspector } from '../scripts/memory/iphone/inspector.mjs';

class Socket {
  static current;
  static unsupported = false;
  constructor() {
    Socket.current = this; this.sent = [];
    queueMicrotask(() => {
      this.onopen();
      queueMicrotask(() => this.message({method:'Target.targetCreated',params:{targetInfo:{type:'page',targetId:'old'}}}));
    });
  }
  message(message) { this.onmessage({data:JSON.stringify(message)}); }
  send(raw) {
    const outer = JSON.parse(raw), inner = outer.method === 'Target.sendMessageToTarget' ? JSON.parse(outer.params.message) : outer;
    this.sent.push({target:outer.params?.targetId ?? null,...inner});
    queueMicrotask(() => this.message({method:'Target.dispatchMessageFromTarget',params:{message:JSON.stringify({
      id:inner.id,...Socket.unsupported && inner.method === 'Page.setBootstrapScript'
        ? {error:{message:'unsupported'}} : {result:{}},
    })}}));
  }
  close() { this.onclose(); }
}
const originalFetch = globalThis.fetch, originalWebSocket = globalThis.WebSocket;
afterEach(() => { globalThis.fetch = originalFetch; globalThis.WebSocket = originalWebSocket; Socket.unsupported = false; });

async function connect() {
  globalThis.WebSocket = Socket;
  globalThis.fetch = async () => Response.json([{url:'about:blank',webSocketDebuggerUrl:'ws://fixture'}]);
  const inspector = await startInspector('fixture');
  return inspector.open();
}

test('capture fixtures precede provisional page execution without enabling Network', async () => {
  const driver = await connect();
  try {
    await driver.bootstrap('window.fixture = "low"');
    const socket = Socket.current;
    const enableOld = socket.sent.findIndex(m => m.target === 'old' && m.method === 'Page.enable');
    const installOld = socket.sent.findIndex(m => m.target === 'old' && m.method === 'Page.setBootstrapScript');
    expect(enableOld).toBeGreaterThanOrEqual(0);
    expect(installOld).toBeGreaterThan(enableOld);
    socket.message({method:'Target.targetCreated',params:{targetInfo:{type:'page',targetId:'next',isProvisional:true,isPaused:true}}});
    const enable = socket.sent.findIndex(m => m.target === 'next' && m.method === 'Page.enable');
    const install = socket.sent.findIndex(m => m.target === 'next' && m.method === 'Page.setBootstrapScript');
    const resume = socket.sent.findIndex(m => m.method === 'Target.resume' && m.params.targetId === 'next');
    expect(enable).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(enable);
    expect(resume).toBeGreaterThan(install);
    expect(socket.sent[install].params.source).toBe('window.fixture = "low"');
    expect(socket.sent.some(m => m.method === 'Network.enable')).toBe(false);
  } finally { await driver.close(); }
});

test('an unsupported bootstrap fails setup instead of silently booting the wrong workload', async () => {
  const driver = await connect();
  try {
    Socket.unsupported = true;
    await expect(driver.bootstrap('window.fixture = "low"')).rejects.toThrow('unsupported');
  } finally { await driver.close(); }
});
