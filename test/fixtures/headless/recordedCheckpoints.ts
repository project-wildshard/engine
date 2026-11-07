import type { HeadlessCommand } from '../../../src/shared/host/tickProtocol';
import type { HeadlessTapeSegment } from '../../../src/shared/host/headlessTape';

interface Mark { id: string; tick: number; flags: string[] }
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let accept: (value: T) => void = () => { throw new Error('Deferred owner not installed'); };
  let refuse: (error: unknown) => void = () => { throw new Error('Deferred owner not installed'); };
  const promise = new Promise<T>((resolve, reject) => { accept = resolve; refuse = reject; });
  return { promise, resolve: accept, reject: refuse };
}
type Publication = { kind: 'parts'; segments: HeadlessTapeSegment[]; gate: ReturnType<typeof deferred<void>> }
  | { kind: 'done' } | { kind: 'error'; error: unknown };

/** Bridge a real native recorder's existing checkpoint fences to one streamed
 * replay. Transport-only fences let recording pause between native ticks before
 * the next bounded part is offered. Named gameplay marks stay exact; no
 * commands are invented and the native step always precedes the next read. */
export function recordedCheckpoints(run: (tick: (commands: HeadlessCommand[]) => Promise<void>, mark: (id: string) => Promise<void>) => Promise<void>,
  step: (commands: readonly HeadlessCommand[]) => void, flags: () => readonly string[]): {
    parts: AsyncGenerator<HeadlessTapeSegment, void, void>; marks: readonly Mark[]; ticks: () => number; stop: () => Promise<void>;
  } {
  const marks: Mark[] = [];
  let frames: HeadlessCommand[][] = [], ticks = 0, start = 0, stopped = false;
  let pending = deferred<Publication>(), gate: ReturnType<typeof deferred<void>> | undefined;
  const publish = async (id: string, checkpoint: boolean): Promise<void> => {
    const captured = frames; frames = [];
    if (checkpoint) marks.push({ id, tick: ticks, flags: [...flags()] });
    const waiting = deferred<void>(); gate = waiting;
    pending.resolve({ kind: 'parts', segments: [{ id, ticks: ticks - start, commands: [], frames: captured }], gate: waiting });
    start = ticks;
    try { await waiting.promise; } finally { if (gate === waiting) gate = undefined; }
  };
  const recording = (async () => {
    try {
      await run(async commands => {
        // Flush before the next input, so an original mark at this exact tick
        // still owns its nonempty last part and original observation id.
        if (frames.length >= 512) await publish(`recording-${start}`, false);
        if (stopped) throw new Error('Native recording owner ended');
        if (ticks >= 60_000) throw new Error('Story exceeds the admitted tape allowance');
        frames.push(structuredClone(commands)); ticks++; step(commands);
      }, id => publish(id, true));
      if (frames.length !== 0) throw new Error('Native recording ended without its final checkpoint');
      pending.resolve({ kind: 'done' });
    } catch (error) { pending.resolve({ kind: 'error', error }); }
  })();
  const stop = async (): Promise<void> => { stopped = true; gate?.reject(new Error('Native recording owner ended')); await recording; };
  async function* parts(): AsyncGenerator<HeadlessTapeSegment, void, void> {
    try {
      for (;;) {
        const next = await pending.promise; pending = deferred<Publication>();
        if (next.kind === 'done') return;
        if (next.kind === 'error') throw next.error;
        for (const segment of next.segments) yield segment;
        next.gate.resolve(undefined);
      }
    } finally { await stop(); }
  }
  return { parts: parts(), marks, ticks: () => ticks, stop };
}
