import { afterEach, expect, test, vi } from 'vitest';
import { WorkerMemoryRows, reportWorkerMemory, type MakeChannel } from './workerMemory';

/** One in-process broadcast bus: what a worker posts, every listener on the page hears. */
function bus(): MakeChannel {
  const channels = new Set<{ onmessage: ((event: MessageEvent<unknown>) => void) | null }>();
  return () => {
    const channel = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      postMessage: (value: unknown) => { for (const other of channels) if (other !== channel) other.onmessage?.({ data: structuredClone(value) } as MessageEvent<unknown>); },
      close: () => { channels.delete(channel); },
    };
    channels.add(channel); return channel;
  };
}
afterEach(() => { vi.useRealTimers(); });

test('each worker isolate reports its ledger by kind; the page keeps one named row each, empty ones included', () => {
  vi.useFakeTimers();
  const make = bus(), page = new WorkerMemoryRows();
  page.listen(make);
  let server: Record<string, number> = { wasm: 3_276_800, physics: 264_196 };
  const stopServer = reportWorkerMemory('standalone-server', make, () => server);
  const stopDecode = reportWorkerMemory('sf18b-decode', make, () => ({}));
  expect(page.kinds(0)).toEqual({ 'standalone-server/wasm': 3_276_800, 'standalone-server/physics': 264_196, 'sf18b-decode/isolate': 0 });
  server = { wasm: 3_276_800 };
  vi.advanceTimersByTime(1000);
  expect(page.kinds(0)).toEqual({ 'standalone-server/wasm': 3_276_800, 'sf18b-decode/isolate': 0 });
  expect(page.read(0).map(row => row.purpose).sort()).toEqual(['sf18b-decode', 'standalone-server']);
  stopServer(); stopDecode();
  // a terminated worker cannot say so: its row goes stale after 30 s without a report
  expect(page.read(40_000)).toEqual([]);
  page.close();
});

test('the page ignores anything that is not a worker memory report', () => {
  const page = new WorkerMemoryRows();
  page.accept({ __wildshardWorkerMemory: 1, id: 'x', name: 'x', purpose: 'x', ram: { wasm: -1 } }, 0);
  page.accept({ id: 'y', name: 'y', purpose: 'y', ram: {} }, 0);
  page.accept('noise', 0);
  expect(page.read(0)).toEqual([]);
});

test('no BroadcastChannel: reporting and listening are no-ops', () => {
  const stop = reportWorkerMemory('x', null);
  stop();
  const page = new WorkerMemoryRows(); page.listen(null); expect(page.kinds()).toEqual({});
});
