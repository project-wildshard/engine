import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { installScopeEnvironment, scopeEnvironment } from '../../../shared/engine/app/scopeEnvironment';
import { waitForDrawnFrame } from './precompile';

const environment = scopeEnvironment(), messageChannel = globalThis.MessageChannel;
afterEach(() => { installScopeEnvironment(environment); Reflect.set(globalThis, 'MessageChannel', messageChannel); vi.useRealTimers(); });

function frames(): () => void {
  const queue = new Map<number, FrameRequestCallback>(); let id = 0, time = 0;
  installScopeEnvironment({ ...environment, frame: render => { queue.set(++id, render); return id; }, cancelFrame: key => { queue.delete(key); } });
  return () => { time += 16; const due = [...queue.values()]; queue.clear(); for (const frame of due) frame(time); };
}
function messages(): { readonly queued: (() => void)[]; readonly closed: (() => boolean)[] } {
  const queued: (() => void)[] = [], closed: (() => boolean)[] = [];
  class Port extends EventTarget {
    stopped = false;
    start(): void { /* Controlled delivery below. */ }
    close(): void { this.stopped = true; }
  }
  Reflect.set(globalThis, 'MessageChannel', class {
    readonly port1 = new Port();
    readonly port2 = { close: (): void => { this.secondClosed = true; }, postMessage: (): void => { queued.push(() => { if (!this.port1.stopped) this.port1.dispatchEvent(new Event('message')); }); } };
    private secondClosed = false;
    constructor() { closed.push(() => this.port1.stopped && this.secondClosed); }
  });
  return { queued, closed };
}
const microtasks = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('native preparation requires a later completed draw and then a separate message task', async () => {
  vi.useFakeTimers(); const frame = frames(), turns = messages(), scope = new Scope('native-task'); let drawn = 1, done = false;
  const census = scope.census;
  try {
    const pending = waitForDrawnFrame(scope, () => drawn, () => true).then(() => { done = true; return undefined; });
    frame(); await microtasks(); expect(done).toBe(false); expect(turns.queued).toHaveLength(0);
    frame(); await microtasks(); expect(done).toBe(false); expect(turns.queued).toHaveLength(0);
    drawn++; frame(); await microtasks(); expect(done).toBe(false); expect(turns.queued).toHaveLength(1);
    turns.queued[0]?.(); await pending; expect(done).toBe(true);
    expect(turns.closed.every(closed => closed())).toBe(true); expect(scope.census).toEqual(census);
    const next = waitForDrawnFrame(scope, () => drawn, () => true);
    frame(); expect(turns.queued).toHaveLength(1);
    drawn++; frame(); expect(turns.queued).toHaveLength(2); turns.queued[1]?.(); await next;
  } finally { scope.dispose(); }
});

test.each(['owner', 'current'])('retiring %s before message delivery refuses before another native batch', async mode => {
  vi.useFakeTimers(); const frame = frames(), turns = messages(), scope = new Scope('native-cancel'); let drawn = 1, current = true;
  try {
    const pending = waitForDrawnFrame(scope, () => drawn, () => current);
    const refused = expect(pending).rejects.toThrow('owner left');
    drawn++; frame(); expect(turns.queued).toHaveLength(1);
    if (mode === 'owner') scope.dispose(); else current = false;
    turns.queued[0]?.(); await refused;
    expect(turns.closed.every(closed => closed())).toBe(true);
  } finally { scope.dispose(); }
});

test('without message ports the completed draw retains its timer task', async () => {
  vi.useFakeTimers(); Reflect.set(globalThis, 'MessageChannel', undefined);
  const frame = frames(), scope = new Scope('native-timer'); let drawn = 1, done = false;
  try {
    const pending = waitForDrawnFrame(scope, () => drawn, () => true).then(() => { done = true; return undefined; });
    drawn++; frame(); await microtasks(); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await pending; expect(done).toBe(true);
  } finally { scope.dispose(); }
});


test('a queued native task cannot advance during an ancestor sliced retirement', async () => {
  vi.useFakeTimers(); const frame = frames(), turns = messages(), parent = new Scope('native-parent'), scope = parent.child('native-child'); let drawn = 1;
  parent.onDispose(() => undefined); // First disposal step precedes the child.
  const pending = waitForDrawnFrame(scope, () => drawn, () => true);
  const refused = expect(pending).rejects.toThrow('owner left');
  drawn++; frame(); expect(turns.queued).toHaveLength(1);
  const retirement = parent.disposeSteps(); retirement.next();
  try {
    expect(scope.disposed).toBe(false); expect(scope.disposing).toBe(true);
    turns.queued[0]?.(); await refused;
    expect(turns.closed.every(closed => closed())).toBe(true);
    await expect(waitForDrawnFrame(scope, () => drawn, () => true)).rejects.toThrow('owner left');
  } finally { for (const _step of retirement) { /* Complete the same retirement. */ } }
});

test('an undelivered message stays pending until retirement closes its ports', async () => {
  vi.useFakeTimers(); const frame = frames(), turns = messages(), scope = new Scope('native-lost-message'); let drawn = 1;
  try {
    let settled = false;
    const pending = waitForDrawnFrame(scope, () => drawn, () => true).finally(() => { settled = true; });
    const refused = expect(pending).rejects.toThrow('owner left');
    drawn++; frame(); expect(turns.queued).toHaveLength(1);
    for (let i = 0; i < 1900; i++) { drawn++; frame(); }
    await microtasks(); expect(settled).toBe(false);
    expect(turns.closed.every(closed => closed())).toBe(false);
    scope.dispose();
    await refused; expect(turns.closed.every(closed => closed())).toBe(true);
    turns.queued[0]?.(); expect(scope.census.timers).toBe(0); expect(scope.census.listeners).toBe(0);
  } finally { scope.dispose(); }
});
