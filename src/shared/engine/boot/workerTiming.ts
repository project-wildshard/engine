import { diagnosticNow } from '../core/clock';
import { Scope } from '../app/scope';
import type { BootTiming, BootTimingEntry } from './timing';

interface TimingScope {
  postMessage?: (value: unknown) => void;
  addEventListener?: (name: string, callback: (event: {data: unknown; stopImmediatePropagation: () => void}) => void, options?: {capture: boolean}) => void;
}

/** Install explicitly at a worker module's first body. Initial graph fetch/evaluation remains a combined parent span. */
export function installWorkerBootTiming(purpose: string): void {
  const scope = globalThis as typeof globalThis & TimingScope;
  if (typeof scope.postMessage !== 'function' || 'document' in globalThis) return;
  const post = scope.postMessage.bind(globalThis);
  const origin = performance.timeOrigin, started = diagnosticNow(), owner = new Scope('worker boot timing');
  let observer: PerformanceObserver | undefined;
  let sequence = 0, queued = false, enabled = false, stopped = false;
  const pending: unknown[] = [], entries: BootTimingEntry[] = [];
  const send = (value: unknown): void => {
    if (stopped) return;
    if (pending.length >= 4096) { pending[4095] = {type:'overflow'}; return; }
    pending.push(value);
    if (queued || !enabled) return;
    queued = true;
    queueMicrotask(() => { queued = false; post({ __engineBootTiming: 1, purpose, origin, records: pending.splice(0) }); });
  };
  const timing: BootTiming = {
    version: 1, build: null, attempt: '', attemptCount: 1, timeOrigin: origin, entries, resources: [], counters: {}, active: [],
    begin: (operation, detail = {}) => {
      if (stopped || entries.length >= 4096) return 0;
      const entry = { id: ++sequence, build: null, attempt: '', realm: purpose, operation, start: diagnosticNow(), end: null, result: 'pending', detail };
      entries.push(entry); send({ type: 'begin', ...entry }); return entry.id;
    },
    end: (id, result = 'complete') => {
      const entry = entries.find(row => row.id === id); if (entry === undefined || entry.end !== null) return;
      entry.end = diagnosticNow(); entry.result = result; send({ type: 'end', id, end: entry.end, result });
    },
    mark: (operation, detail = {}) => { send({ type: 'mark', operation, start: diagnosticNow(), detail }); },
    progress: (operation, delta, total, unit) => { send({ type: 'progress', operation, delta, total, unit, start: diagnosticNow() }); },
    read: () => timing, finish: () => { /* The page owns retention, not the worker's runtime lifetime. */ },
  };
  owner.listen(scope, 'message', (event: MessageEvent<unknown>) => {
    const value: unknown = event.data;
    if (typeof value !== 'object' || value === null) return;
    if ('__engineBootTiming' in value && 'serviceWorker' in value && 'records' in value && Array.isArray(value.records)) {
      event.stopImmediatePropagation(); for (const row of value.records) send({type:'service-worker',value:row}); return;
    }
    if ('__engineBootStop' in value) { event.stopImmediatePropagation(); stopped = true; pending.length = 0; observer?.disconnect(); owner.dispose(); Reflect.deleteProperty(globalThis, '__bootTiming'); return; }
    if (!('__engineBootPing' in value)) return;
    event.stopImmediatePropagation();
    const w1 = diagnosticNow();
    if (!enabled) { enabled = true; Reflect.set(globalThis, '__bootTiming', timing); timing.mark('worker:code-ready'); observeResources(); }
    post({ __engineBootTiming: 1, purpose, origin, pong: { p0: value.__engineBootPing, w1, w2: diagnosticNow() } });
  }, { capture: true });
  timing.mark('worker:module-body', { purpose, firstBody: started });
  function observeResources(): void {
  if (typeof PerformanceObserver === 'function') {
    try {
      performance.setResourceTimingBufferSize(4096);
      observer = new PerformanceObserver(list => { for (const row of list.getEntries()) send({ type: 'resource', value: row.toJSON() }); });
      observer.observe({ type: 'resource', buffered: true });
      owner.listen(performance, 'resourcetimingbufferfull', () => { timing.mark('resource-buffer-overflow'); });
    } catch { timing.mark('resource-timing-unavailable'); }
  } else timing.mark('resource-timing-unavailable');
  }
}
