// meta DRIFTWOOD-FPS DF8 (mini-driftwood13m): `debug.taskStamp` stamps the long callbacks a page runs, and the late probe.
import { describe, expect, test } from 'vitest';
import { installTaskStamp, PROBE_EVERY_MS, TaskStampLog } from './taskStamp';

type Handler = (this: unknown, event?: { type: string }) => void;
/** A fake page with no Promise (the real one stays untouched): timers run by hand, a clock moved by hand. */
function fakeScope() {
  let clock = 0;
  const timers: { run: () => void; at: number }[] = [];
  class Target {
    private readonly ls = new Map<string, Set<Handler>>();
    addEventListener(type: string, l: Handler): void { const set = this.ls.get(type) ?? new Set<Handler>(); set.add(l); this.ls.set(type, set); }
    removeEventListener(type: string, l: Handler): void { this.ls.get(type)?.delete(l); }
    fire(type: string): void { for (const l of this.ls.get(type) ?? []) l.call(this, { type }); }
    count(type: string): number { return this.ls.get(type)?.size ?? 0; }
  }
  class Port extends Target {
    private h: Handler | null = null;
    get onmessage(): Handler | null { return this.h; }
    set onmessage(v: Handler | null) { this.h = v; }
    run(): void { if (this.h !== null) Reflect.apply(this.h, this, []); }
  }
  class Observer {
    readonly notify: () => void;
    constructor(notify: () => void) { this.notify = notify; }
  }
  const scope = {
    setTimeout: (run: () => void, ms = 0): number => { timers.push({ run, at: clock + ms }); return timers.length; },
    EventTarget: Target, MessagePort: Port, MutationObserver: Observer,
  };
  return {
    scope: scope as unknown as typeof globalThis, now: (): number => clock, spend: (ms: number): void => { clock += ms; },
    runDue: (): void => { for (const t of timers.filter(x => x.at <= clock)) { timers.splice(timers.indexOf(t), 1); t.run(); } },
    Target, Port, timeout: scope.setTimeout,
    observer: (notify: () => void): Observer => new (scope.MutationObserver as unknown as new (n: () => void) => Observer)(notify),
  };
}

describe('taskStamp', () => {
  test('a long timer, listener, onmessage and observer callback is stamped with its kind and name; a short one is not', () => {
    const page = fakeScope();
    const log = installTaskStamp(page.scope, page.now);
    const timeout = (page.scope as unknown as { setTimeout: (run: () => void, ms: number) => number }).setTimeout;
    const look = (): void => { page.spend(9); }, quick = (): void => { page.spend(1); };
    timeout(look, 0); timeout(quick, 0);
    page.runDue();
    const target = new page.Target(), onBig = (): void => { page.spend(30); };
    target.addEventListener('message', onBig); target.fire('message');
    target.removeEventListener('message', onBig);
    expect(target.count('message')).toBe(0);
    const port = new page.Port(), onPort = (): void => { page.spend(5); };
    port.onmessage = onPort; port.run();
    expect(port.onmessage).toBe(onPort);
    const watch = (): void => { page.spend(4); };
    page.observer(watch).notify();
    const labels = log.read(0, 1e9).map(r => r[2]);
    expect(labels).toContain('timeout:look');
    expect(labels).not.toContain('timeout:quick');
    expect(labels).toContain('Target.message:onBig');
    expect(labels).toContain('Port.onmessage:onPort');
    expect(labels).toContain('MutationObserver:watch');
  });
  test('the probe records how late it ran, and only when 12 ms or more', () => {
    const page = fakeScope();
    const log = installTaskStamp(page.scope, page.now);
    page.spend(PROBE_EVERY_MS); page.runDue();
    page.spend(PROBE_EVERY_MS + 40); page.runDue();
    expect(log.lates(0, 1e9)).toEqual([[20, 40]]);
  });
  test('a probe whose sentinel is gone marks a collection between it and the probe before', () => {
    const page = fakeScope();
    let alive = true;
    class Weak { private readonly held: object; constructor(target: object) { this.held = target; } deref(): object | undefined { return alive ? this.held : undefined; } }
    const log = installTaskStamp({ ...(page.scope as unknown as object), WeakRef: Weak } as unknown as typeof globalThis, page.now);
    page.spend(PROBE_EVERY_MS); page.runDue();
    expect(log.collections(0, 1e9)).toEqual([]);
    alive = false; page.spend(PROBE_EVERY_MS); page.runDue();
    expect(log.collections(0, 1e9)).toEqual([[10, 20]]);
  });
  test('the ring answers only what overlaps the asked window', () => {
    const log = new TaskStampLog();
    log.record(100, 30, 'a'); log.record(200, 5, 'b');
    expect(log.read(120, 150)).toEqual([[100, 30, 'a']]);
    expect(log.read(300, 400)).toEqual([]);
    expect(log.count).toBe(2);
  });
});
