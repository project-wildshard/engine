// SERVER-CELLS (draft, opus-cellmem): Prometheus text for a dedicated server under a bench, with no change to the server. Loaded with
// `node --import ./scripts/cell-mem/metrics-preload.mjs main.mjs` and `METRICS_PORT` set; without that env it does nothing.
// The main thread serves `/metrics` on 127.0.0.1 only. Every worker thread (the same preload runs there) sends its own event-loop
// delay and heap over a BroadcastChannel. The door's own `{"at":"worker"}` log rows (cells resident and awake, players, tick time)
// are read off `console.info` as they are written, and still written. Nothing leaves loopback; nothing here alters a reply or a tick.
import { createServer } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { BroadcastChannel, isMainThread, threadId } from 'node:worker_threads';

const port = Number(process.env.METRICS_PORT ?? 0);
if (Number.isInteger(port) && port > 0) {
  const channel = new BroadcastChannel('wildshard-cell-metrics'), delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  // The histogram's samples include its own 10 ms timer: what is past that is lag.
  const ms = (/** @type {number} */ ns) => Math.max(0, ns / 1e6 - 10);
  const own = () => { const memory = process.memoryUsage(); return { thread: threadId, p50: ms(delay.percentile(50)), p99: ms(delay.percentile(99)), max: ms(delay.max), heap: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external, arrayBuffers: memory.arrayBuffers }; };
  if (!isMainThread) {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- A BroadcastChannel has no origin to name.
    const timer = setInterval(() => { channel.postMessage(own()); delay.reset(); }, 5_000);
    timer.unref(); channel.unref();
  } else {
    /** @type {Map<number, ReturnType<typeof own>>} */
    const threads = new Map();
    /** @type {Map<number, Record<string, number>>} */
    const workers = new Map();
    channel.onmessage = event => { const row = /** @type {ReturnType<typeof own>} */ (/** @type {{ data: unknown }} */ (event).data); threads.set(row.thread, row); };
    channel.unref();
    const info = console.info.bind(console);
    console.info = (...args) => {
      const [line] = args;
      if (typeof line === 'string' && line.startsWith('{"at":"worker"')) try { const row = JSON.parse(line); workers.set(row.index, row); } catch { /* still logged */ }
      info(...args);
    };
    let main = own();
    setInterval(() => { main = own(); delay.reset(); }, 5_000).unref();
    /** @param {string} labels */
    const pair = (labels, /** @type {number} */ value) => /** @type {[string, number]} */ ([labels, value]);
    const text = () => {
      const memory = process.memoryUsage(), cpu = process.cpuUsage(), rows = /** @type {string[]} */ ([]);
      const metric = (/** @type {string} */ name, /** @type {string} */ type, /** @type {[string, number][]} */ values) => { rows.push(`# TYPE ${name} ${type}`); for (const [labels, value] of values) rows.push(`${name}${labels} ${String(value)}`); };
      const perThread = (/** @type {'heap' | 'external' | 'arrayBuffers'} */ field, /** @type {number} */ mainValue) => [pair('{thread="main"}', mainValue), ...[...threads.values()].map(row => pair(`{thread="${String(row.thread)}"}`, row[field]))];
      metric('process_resident_memory_bytes', 'gauge', [pair('', memory.rss)]);
      metric('process_cpu_seconds_total', 'counter', [pair('', (cpu.user + cpu.system) / 1e6)]);
      metric('nodejs_heap_used_bytes', 'gauge', perThread('heap', memory.heapUsed));
      metric('nodejs_external_bytes', 'gauge', perThread('external', memory.external));
      metric('nodejs_array_buffers_bytes', 'gauge', perThread('arrayBuffers', memory.arrayBuffers));
      metric('nodejs_eventloop_lag_seconds', 'summary', [main, ...threads.values()].flatMap(row => {
        const name = row === main ? 'main' : String(row.thread);
        return [pair(`{thread="${name}",quantile="0.5"}`, row.p50 / 1000), pair(`{thread="${name}",quantile="0.99"}`, row.p99 / 1000), pair(`{thread="${name}",quantile="1"}`, row.max / 1000)];
      }));
      const each = (/** @type {string} */ field) => [...workers.entries()].map(([index, row]) => pair(`{worker="${String(index)}"}`, row[field] ?? 0));
      metric('wildshard_cells_resident', 'gauge', each('cells'));
      metric('wildshard_cells_awake', 'gauge', each('awake'));
      metric('wildshard_players', 'gauge', each('players'));
      metric('wildshard_tick_seconds', 'summary', [...workers.entries()].flatMap(([index, row]) => [['0.5', 'p50'], ['0.95', 'p95'], ['0.99', 'p99'], ['1', 'max']].map(([q, field]) => pair(`{worker="${String(index)}",quantile="${q}"}`, (row[field] ?? 0) / 1000))));
      metric('wildshard_ticks_per_second', 'gauge', each('ticksPerSecond'));
      metric('wildshard_tick_drops', 'gauge', each('drops'));
      return `${rows.join('\n')}\n`;
    };
    createServer((request, response) => {
      if (request.url !== '/metrics') { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(text());
    }).on('error', error => { console.error(JSON.stringify({ at: 'metrics.refused', port, error: String(error) })); }).listen(port, '127.0.0.1').unref();
  }
}
