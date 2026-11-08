import type { Scope } from '../../../shared/engine/app/scope';

/** LS7: why a fenced unit earned no credit. The message keeps "WebGL context lost" for a loss, which the boot's GPU
 *  failure path matches (finish.ts). */
export class FenceAbortError extends Error {
  readonly reason: 'disposed' | 'context-lost' | 'wait-failed';
  constructor(reason: 'disposed' | 'context-lost' | 'wait-failed', message: string) {
    super(message); this.name = 'FenceAbortError'; this.reason = reason;
  }
}

interface Entry { readonly sync: WebGLSync | null; readonly done: () => void }

/** LS7: GPU units in flight, each counted only once its WebGL2 fence has signalled (ALREADY_SIGNALED or
 *  CONDITION_SATISFIED). The next unit is submitted before the last fence resolves (at most `depth` in flight), so the
 *  GPU never idles through the frame the fence poll waits for; the poll is non-blocking, once per painted frame. `mark`
 *  runs a callback in order once every unit before it has signalled, with no GPU work of its own.
 *
 *  No path credits work that did not signal: a lost context (at submit or at a poll), a WAIT_FAILED result or the
 *  owner scope's disposal rejects with a FenceAbortError and credits nothing further. Every exit releases every queued
 *  native sync: the abort itself, `dispose()` (the caller's finally, which covers a throwing callback or a rejected
 *  preparation step) and the owner scope's disposal, which also settles a pending wait instead of leaving it hung. */
export class FencedUnits {
  private readonly queue: Entry[] = [];
  private readonly gl: WebGL2RenderingContext;
  private readonly scope: Scope;
  private readonly depth: number;
  private readonly forgetOwner: () => void;
  private readonly waits = new Set<(error: Error) => void>();
  private aborted: FenceAbortError | null = null;
  /** Native syncs created and deleted, for the lifecycle proofs */
  readonly census = { created: 0, deleted: 0, credited: 0 };

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext, scope: Scope, depth = 2) {
    if (!('fenceSync' in gl)) throw new Error('LS7 fenced units need WebGL2 fences');
    this.gl = gl; this.scope = scope; this.depth = depth;
    this.forgetOwner = scope.capture('disposers', () => { this.abort(new FenceAbortError('disposed', `Fenced units cancelled: ${scope.name} disposed`)); });
  }

  /** Native syncs still queued (never signalled, never released) */
  get pending(): number { return this.queue.filter(entry => entry.sync !== null).length; }

  /** After a unit's commands are submitted: fence them; wait only while `depth` units are in flight. */
  async submit(done: () => void): Promise<void> {
    this.check();
    const gl = this.gl;
    const sync = gl.isContextLost() ? null : gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (sync === null) throw this.abort(new FenceAbortError('context-lost', 'WebGL context lost: a first-frame unit has no fence'));
    this.census.created++;
    gl.flush();
    this.queue.push({ sync, done });
    while (this.queue.length >= this.depth) await this.poll();
  }

  mark(done: () => void): void { this.check(); this.queue.push({ sync: null, done }); this.settle(); }

  async drain(): Promise<void> { while (this.queue.length > 0) await this.poll(); this.check(); }

  /** Release every queued native sync and stop. Idempotent; the caller's finally runs it on every exit. */
  dispose(): void {
    this.forgetOwner();
    this.release();
    this.aborted ??= new FenceAbortError('disposed', 'Fenced units disposed');
    for (const fail of this.waits) fail(this.aborted);
  }

  private check(): void { if (this.aborted !== null) throw this.aborted; if (this.scope.disposed) throw this.abort(new FenceAbortError('disposed', `Fenced units cancelled: ${this.scope.name} disposed`)); }

  private abort(error: FenceAbortError): FenceAbortError {
    this.aborted ??= error;
    this.release();
    for (const fail of this.waits) fail(this.aborted);
    return this.aborted;
  }

  private release(): void {
    for (const entry of this.queue.splice(0)) {
      if (entry.sync === null) continue;
      this.gl.deleteSync(entry.sync); this.census.deleted++;
    }
  }

  /** One painted frame (rAF alone resumes before the paint), settled by the owner's disposal rather than left hung */
  frame(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.aborted !== null) { reject(this.aborted); return; }
      let open = true;
      const end = (error?: Error): void => {
        if (!open) return;
        open = false; this.waits.delete(end);
        if (error === undefined) resolve(); else reject(error);
      };
      this.waits.add(end);
      this.scope.raf(() => { this.scope.timeout(0, () => { end(); }); });
    });
  }

  private async poll(): Promise<void> { await this.frame(); this.check(); this.settle(); }

  private settle(): void {
    const gl = this.gl;
    for (let head = this.queue[0]; head !== undefined; head = this.queue[0]) {
      if (head.sync !== null) {
        if (gl.isContextLost()) throw this.abort(new FenceAbortError('context-lost', 'WebGL context lost with a first-frame fence in flight'));
        const status = gl.clientWaitSync(head.sync, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) return;
        if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) throw this.abort(new FenceAbortError('wait-failed', `WebGL fence wait failed (0x${status.toString(16)})`));
        gl.deleteSync(head.sync); this.census.deleted++;
      }
      this.queue.shift();
      if (head.sync !== null) this.census.credited++;
      head.done();
    }
  }
}
