import { pageScope } from '../../../shared/engine/app/resources';
import type { Scope } from '../../../shared/engine/app/scope';
import { isDev } from '../core/devMode';
import { waitFor } from '../../../shared/engine/boot/waits';
import { decodeParsedPages } from './parsedPages';

interface Pending { readonly kind: 'parse-pages'; readonly scope: Scope; readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void }
function replyError(value: unknown): Error {
  if (typeof value !== 'object' || value === null) return new Error('Invalid live JSON failure');
  const name: unknown = Reflect.get(value, 'name'), message: unknown = Reflect.get(value, 'message');
  if (typeof message !== 'string') return new Error('Invalid live JSON failure');
  if (name === 'SyntaxError') return new SyntaxError(message);
  if (name === 'TypeError') return new TypeError(message);
  if (name === 'RangeError') return new RangeError(message);
  return new Error(message);
}
/** One explicitly owned data-only worker. It never receives a renderer, world,
 * storage port or live caller buffer. Original validators still own admission. */
export class LiveJsonParser {
  private readonly scope: Scope;
  private worker: Worker | null = null;
  private thread: Scope | null = null;
  private idle: Scope | null = null;
  private held = false;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly createWorker: () => Worker;
  constructor(owner: Scope, createWorker: () => Worker = () => new Worker(new URL('liveJsonParser.worker.ts', import.meta.url), { type: 'module', name: 'live-json-parser' })) {
    this.createWorker = createWorker;
    this.scope = owner.child('live-json-parser');
    this.scope.onDispose(() => { this.stop(new Error('Live JSON owner ended')); });
  }
  private stop(reason: Error): void {
    const active = this.worker, thread = this.thread;
    this.worker = null; this.thread = null; this.idle = null;
    const requests = [...this.pending.values()]; this.pending.clear();
    for (const request of requests) { request.scope.dispose(); request.reject(reason); }
    active?.terminate(); thread?.dispose();
  }
  private receive(event: MessageEvent<unknown>): void {
    const data = event.data;
    if (typeof data !== 'object' || data === null) { this.stop(new Error('Invalid live JSON reply')); return; }
    const id: unknown = Reflect.get(data, 'id');
    if (typeof id !== 'number' || !Number.isSafeInteger(id)) { this.stop(new Error('Invalid live JSON identity')); return; }
    const request = this.pending.get(id); if (request === undefined) return;
    if (Reflect.get(data, 'kind') !== request.kind) { this.stop(new Error('Live JSON operation differs')); return; }
    this.pending.delete(id); request.scope.dispose();
    if (Reflect.get(data, 'ok') === true && Object.hasOwn(data, 'value')) request.resolve(Reflect.get(data, 'value'));
    else request.reject(replyError(Reflect.get(data, 'error')));
    if (this.pending.size === 0 && this.thread !== null && !this.held) {
      this.idle?.dispose(); this.idle = this.thread.child('idle');
      this.idle.timeout(30_000, () => { if (this.pending.size === 0 && !this.held) this.stop(new Error('Live JSON idle')); });
    }
  }
  private start(): Worker {
    if (this.scope.disposed || this.scope.disposing) throw new Error('Live JSON owner ended');
    if (this.worker !== null) return this.worker;
    const thread = this.scope.child('thread');
    try {
      const made = this.createWorker(); this.worker = made; this.thread = thread;
      thread.listen(made, 'message', event => { this.receive(event); });
      thread.listen(made, 'error', event => { event.preventDefault(); this.stop(new Error('Live JSON worker failed')); });
      thread.listen(made, 'messageerror', () => { this.stop(new Error('Live JSON transfer failed')); });
      thread.onDispose(() => { if (this.thread === thread) this.stop(new Error(this.scope.disposed || this.scope.disposing ? 'Live JSON owner ended' : 'Live JSON thread ended')); });
      return made;
    } catch (error) {
      if (this.thread === thread) this.stop(error instanceof Error ? error : new Error(String(error)));
      else thread.dispose();
      throw error;
    }
  }
  private work(value: Uint8Array): Promise<unknown> {
    const kind = 'parse-pages';
    try {
      const made = this.start(), thread = this.thread;
      if (thread === null) throw new Error('Live JSON thread missing');
      this.idle?.dispose(); this.idle = null;
      const id = ++this.sequence, tag = `live-json-parser:${kind}:${id}`;
      let profile = false;
      try {
        if (isDev() && typeof performance.mark === 'function' && typeof performance.measure === 'function') { performance.mark(tag); profile = true; }
      } catch { /* Diagnostics never replace the worker result. */ }
      const result = new Promise<unknown>((resolve, reject) => {
        const request = thread.child(kind);
        this.pending.set(id, { kind, scope: request, resolve, reject });
        try {
          // Copy only the verified input; caller/cache backing stays attached.
          const copy = Uint8Array.from(value);
          made.postMessage({ id, kind, value: copy }, { transfer: [copy.buffer] });
        } catch (error) { this.stop(error instanceof Error ? error : new Error(String(error))); }
      });
      const measured = !profile ? result : result.finally(() => {
        // Diagnostics cannot grant or refuse the data operation.
        try {
          const name = `wildshard.prepare:live-json-parser:${kind}`;
          performance.clearMeasures(name); performance.measure(name, { start: tag, detail: { operation: kind } });
          performance.clearMarks(tag);
        } catch { /* The original result retains its authority. */ }
      });
      return waitFor('Read world data', measured, 'worker');
    } catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); }
  }
  /** Start the worker now and keep it to the owner's end (DL17, G872): a page that parses in play fetches no worker script
   * after control; an idle worker no longer retires. */
  hold(): void { this.held = true; this.idle?.dispose(); this.idle = null; if (typeof Worker !== 'undefined') this.start(); }
  /** Native worker parsing with bounded transferable pages and paced reconstruction.
   * Avoids a whole descriptor structured clone on the live page thread. */
  async parsePaced(bytes: Uint8Array, pause: () => Promise<void>): Promise<unknown> {
    const result = await this.work(bytes);
    if (!(result instanceof Uint8Array)) {
      this.stop(new Error('Invalid paged live JSON reply'));
      throw new Error('Invalid paged live JSON reply');
    }
    const current = async (): Promise<void> => {
      if (this.scope.disposed || this.scope.disposing) throw new Error('Live JSON owner ended');
      await pause();
      if (this.scope.disposed || this.scope.disposing) throw new Error('Live JSON owner ended');
    };
    return decodeParsedPages(result, current);
  }
}
let browserParser: LiveJsonParser | undefined;
/** Live admission only; boot JSON and every receipt retain the main-thread path. */
export function browserLiveJsonParser(): LiveJsonParser { return (browserParser ??= new LiveJsonParser(pageScope)); }
