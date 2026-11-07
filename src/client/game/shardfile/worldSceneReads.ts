import type { Scope } from '@wildshard/engine/app/scope';
import type { ShardContext } from '../plugin/context';

type Context = Pick<ShardContext, 'scope'> & { readonly product: Pick<ShardContext['product'], 'file' | 'hasFile'> };

type Result = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly error: unknown };
interface Read { readonly name: string; readonly ready: Promise<Result>; readonly settle: (result: Result) => void }

/** One admission's verified metadata reads. Parsing and publication remain at
 * their original ordered cursor; this pool never decodes or allocates a scene. */
export class WorldSceneReads {
  private readonly entries = new Map<string, Read>();
  private readonly queued: Read[] = [];
  private active = 0;
  private stopped = false;
  private readonly product;
  private readonly read;
  private readonly scope;
  private readonly forget: readonly (() => void)[];
  constructor(private readonly ctx: Context, private readonly resident: Scope, files: readonly string[]) {
    this.product = ctx.product; this.read = this.product.file; this.scope = ctx.scope;
    this.validate();
    this.queue(files);
    this.forget = [...new Set([this.scope, resident])].map(owner => owner.capture('disposers', () => { this.stop(new Error('Scene placement owner is disposed')); }));
  }
  validate(): void {
    if (this.scope.disposed || this.scope.disposing || this.resident.disposed || this.resident.disposing) throw new Error('Scene placement owner is disposed');
    if (this.ctx.scope !== this.scope || this.ctx.product !== this.product || this.product.file !== this.read) throw new Error('Scene read owner changed');
  }
  queue(files: readonly string[]): void {
    this.validate();
    if (files.every(name => this.entries.has(name))) return;
    if (this.stopped) throw new Error('Scene reads have stopped');
    // A missing declared suffix starts no speculative transport.
    for (const name of files) if (!this.product.hasFile(name)) throw new Error(`Missing world scene blob: ${name}`);
    for (const name of files) {
      if (this.entries.has(name)) continue;
      let settle: (result: Result) => void = () => undefined;
      const ready = new Promise<Result>(resolve => { settle = resolve; });
      const entry = { name, ready, settle }; this.entries.set(name, entry); this.queued.push(entry);
    }
    this.pump();
  }
  private stop(error: unknown): void {
    this.stopped = true;
    for (const entry of this.queued.splice(0)) entry.settle({ ok: false, error });
  }
  private pump(): void {
    try { this.validate(); } catch (error) { this.stop(error); }
    while (!this.stopped && this.active < 16) {
      const entry = this.queued.shift(); if (entry === undefined) break;
      this.active++;
      void this.start(entry);
    }
  }
  private async start(entry: Read): Promise<void> {
    try {
      this.validate();
      const bytes = await this.read.call(this.product, entry.name);
      entry.settle({ ok: true, bytes }); this.active--; this.pump();
    } catch (error) {
      entry.settle({ ok: false, error }); this.active--; this.stop(error);
    }
  }

  async file(name: string): Promise<Uint8Array> {
    this.validate();
    let entry = this.entries.get(name);
    if (entry === undefined) { this.queue([name]); entry = this.entries.get(name); }
    if (entry === undefined) throw new Error('Missing scene read');
    const result = await entry.ready;
    this.validate();
    if (!result.ok) throw result.error;
    return result.bytes;
  }
  /** Stop queued work, drain every started read, and release all byte results. */
  async close(): Promise<void> {
    this.stop(new Error('Scene reads are closed'));
    await Promise.all([...this.entries.values()].map(entry => entry.ready));
    this.entries.clear();
    for (const forget of this.forget) forget();
  }
}
