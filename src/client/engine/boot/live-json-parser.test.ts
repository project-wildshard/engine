import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { LiveJsonParser } from './liveJsonParser';
import { parseJsonPages } from './parsedPages';
import { isDev, setDev } from '../core/devMode';

class ControlledWorker extends EventTarget implements Worker {
  onerror: Worker['onerror'] = null;
  onmessage: Worker['onmessage'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  readonly sent: unknown[] = [];
  terminated = false;
  postMessage(value: unknown, options?: Transferable[] | StructuredSerializeOptions): void {
    const transfer = Array.isArray(options) ? options : options?.transfer;
    this.sent.push(structuredClone(value, transfer === undefined ? {} : { transfer }));
  }
  terminate(): void { this.terminated = true; }
  reply(data: unknown): void { this.dispatchEvent(new MessageEvent('message', { data })); }
  complete(index = 0): void {
    const request = this.sent[index];
    if (typeof request !== 'object' || request === null) throw new Error('Missing request');
    const id: unknown = Reflect.get(request, 'id'), kind: unknown = Reflect.get(request, 'kind');
    if (kind !== 'parse-pages') throw new Error('Invalid test operation');
    try {
      const bytes: unknown = Reflect.get(request, 'value');
      if (!(bytes instanceof Uint8Array)) throw new TypeError('Live JSON parser requires bytes');
      this.reply({ id, kind, ok: true, value: parseJsonPages(bytes) });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.reply({ id, kind, ok: false, error: { name: error.name, message: error.message } });
    }
  }
}
const owners: Scope[] = [], pause = (): Promise<void> => Promise.resolve();
function fixture(): { owner: Scope; worker: ControlledWorker; client: LiveJsonParser } {
  const owner = new Scope('live-json-test'), worker = new ControlledWorker(); owners.push(owner);
  return { owner, worker, client: new LiveJsonParser(owner, () => worker) };
}
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.useRealTimers(); });

test('live pages preserve exact JSON and attached caller bytes across out-of-order replies', async () => {
  const { client, worker } = fixture();
  const source = { unicode: '森林 🐟', precise: 0.004753960503472321, zero: -0, nested: [null, false, ''] };
  const bytes = new TextEncoder().encode(JSON.stringify(source)), before = bytes.slice();
  const first = client.parsePaced(bytes, pause), second = client.parsePaced(new TextEncoder().encode('[1,2,3]'), pause);
  source.unicode = 'caller mutation'; worker.complete(1); worker.complete(0);
  expect(await second).toEqual([1,2,3]);
  expect(await first).toEqual(JSON.parse(new TextDecoder().decode(before)));
  expect(bytes).toEqual(before); expect(bytes.byteLength).toBe(before.length);
});

test.each([new Uint8Array([0xff]), new TextEncoder().encode('{broken')])('malformed bytes retain native parser refusal', async bytes => {
  const { client, worker } = fixture();
  const refused = expect(client.parsePaced(bytes, pause)).rejects.toThrow(bytes[0] === 0xff ? TypeError : SyntaxError);
  worker.complete(); await refused; expect(bytes.length).toBeGreaterThan(0);
});

test('operation mismatch drains every job and the owned thread', async () => {
  const { client, worker, owner } = fixture();
  const left = expect(client.parsePaced(new Uint8Array([49]), pause)).rejects.toThrow('operation differs');
  const right = expect(client.parsePaced(new Uint8Array([50]), pause)).rejects.toThrow('operation differs');
  worker.reply({ id: 1, kind: 'unknown', ok: true, value: new Uint8Array() });
  await Promise.all([left, right]);
  expect(worker.terminated).toBe(true); expect(owner.census.listeners).toBe(0); expect(owner.census.timers).toBe(0);
});

test('elapsed time cannot refuse pending parsing; real worker failure drains every job', async () => {
  vi.useFakeTimers(); const { client, worker, owner } = fixture();
  const left = client.parsePaced(new Uint8Array([49]), pause);
  const right = client.parsePaced(new Uint8Array([50]), pause);
  let settled = false;
  const both = Promise.all([left, right]).finally(() => { settled = true; });
  const refused = expect(both).rejects.toThrow('worker failed');
  await vi.advanceTimersByTimeAsync(180_000);
  expect(settled).toBe(false); expect(worker.terminated).toBe(false);
  expect(owner.census.timers).toBe(0);
  worker.dispatchEvent(new Event('error', { cancelable: true }));
  await refused; expect(worker.terminated).toBe(true);
  expect(owner.census.listeners).toBe(0); expect(owner.census.timers).toBe(0);
});

test('a slow valid reply still publishes exact data without restarting the worker', async () => {
  vi.useFakeTimers(); const { client, worker } = fixture();
  const bytes = new TextEncoder().encode('{"kept":[1,2,3]}');
  const pending = client.parsePaced(bytes, pause);
  await vi.advanceTimersByTimeAsync(180_000);
  worker.complete(); expect(await pending).toEqual({ kept: [1, 2, 3] });
  expect(worker.sent).toHaveLength(1);
});

test('owner disposal refuses pending and future parses without publication', async () => {
  const { client, worker, owner } = fixture();
  const refused = expect(client.parsePaced(new Uint8Array([49]), pause)).rejects.toThrow('owner ended');
  owner.dispose(); await refused;
  await expect(client.parsePaced(new Uint8Array([49]), pause)).rejects.toThrow('owner ended'); expect(worker.terminated).toBe(true);
});

test('unused workers stay absent and idle threads retire then recreate', async () => {
  vi.useFakeTimers(); const owner = new Scope('idle-live-parser'); owners.push(owner);
  const workers: ControlledWorker[] = [], create = vi.fn(() => {const worker = new ControlledWorker(); workers.push(worker); return worker;});
  const client = new LiveJsonParser(owner, create);
  await vi.advanceTimersByTimeAsync(30_000); expect(create).not.toHaveBeenCalled();
  const pending = client.parsePaced(new Uint8Array([49]), pause), worker = workers[0];
  if (worker === undefined) throw new Error('No worker');
  worker.complete(); expect(await pending).toBe(1);
  await vi.advanceTimersByTimeAsync(30_000); expect(worker.terminated).toBe(true);
  expect(owner.census.listeners).toBe(0); expect(owner.census.timers).toBe(0);
  const next = client.parsePaced(new Uint8Array([50]), pause), replacement = workers[1];
  if (replacement === undefined) throw new Error('No replacement');
  replacement.complete(); expect(await next).toBe(2); expect(create).toHaveBeenCalledTimes(2);
});

test('diagnostic mark failures cannot refuse valid live parsing', async () => {
  const previous = isDev(); setDev(true);
  const mark = vi.spyOn(performance, 'mark').mockImplementation(() => {throw new Error('diagnostic unavailable');});
  try {const {client, worker} = fixture(), pending = client.parsePaced(new Uint8Array([49]), pause); worker.complete(); expect(await pending).toBe(1);}
  finally {mark.mockRestore(); setDev(previous);}
});

test('retirement during paced reconstruction retains the publication fence', async () => {
  const {owner, client, worker} = fixture();
  const parsed = client.parsePaced(new TextEncoder().encode('[1,2,3]'), () => {owner.dispose(); return Promise.resolve();});
  const refused = expect(parsed).rejects.toThrow('owner ended'); worker.complete(); await refused;
});
