/**
 * Fault isolation (E133, audit fix 5 / FINISH-LINE S2): one system that throws must not freeze the whole game.
 *
 * Game.ts wraps every registered system (input, each fixed phase, update, late) in a `GameSystem` and calls it inside
 * one try/catch. A throw lands in `recordFault`, which decides:
 *
 *   'retry'  — log it (the first time, with its stack), report it, run the system again next frame
 *   'fatal'  — the same trip on a CORE system (the render, the sky, the physics step, the player's step): the game
 *              cannot go on without it, so the loop stops and the fatal modal goes up (src/client/engine/ui/ErrorModal.ts)
 *
 * Nothing here allocates while nothing throws: the per-system counters are plain numbers, and the burst ring is only
 * created on a system's first fault. Listeners (the reporter and the modal) hear every fault through `onFault`.
 *
 * The GAME-NORMALIZATION plan's SystemRegistry (`add({ id, phase, run })`) slots over this unchanged: its `id` is
 * this `label`, and each phase list becomes a list of `GameSystem`s.
 */

import { onOwnerDispose } from '../app/ownership';

/** frames in a row that throw before a core system stops the loop */
export const FAULT_STREAK = 3;
/** throws inside FAULT_WINDOW_MS before a core system stops the loop, consecutive or not */
export const FAULT_BURST = 5;
export const FAULT_WINDOW_MS = 10_000;

export type FaultVerdict = 'retry' | 'fatal';

export interface GameSystem<F> {
  readonly fn: F;
  /** what a report calls it: the registration's label, else the function's name, else `<phase>#<n>` */
  readonly label: string;
  /** the game cannot run without it: repeated failures stop the loop */
  readonly core: boolean;
  /** false only after a core failure stops the loop */
  on: boolean;
  /** every throw, ever */
  faults: number;
  /** frames in a row that threw (a frame that throws in several fixed steps counts once) */
  streak: number;
  /** the frame number of the last throw (-1: never) */
  lastFrame: number;
  /** the times of the last FAULT_BURST throws (a ring; null until the first) */
  recent: Float64Array | null;
}

export function makeSystem<F>(fn: F, label: string | undefined, core: boolean, fallback: string): GameSystem<F> {
  const named = typeof fn === 'function' && typeof fn.name === 'string' && fn.name !== '' && fn.name !== 'anonymous' ? fn.name : '';
  return { fn, label: label ?? (named || fallback), core, on: true, faults: 0, streak: 0, lastFrame: -1, recent: null };
}

/**
 * Count one throw of `s` during frame `frame` at time `now` (ms). Non-core systems always retry;
 * only a repeated core failure stops the loop. Registration lifetime never changes on a non-core fault.
 */
export function recordFault(s: GameSystem<unknown>, frame: number, now: number): FaultVerdict {
  if (frame !== s.lastFrame) s.streak = frame === s.lastFrame + 1 ? s.streak + 1 : 1;
  s.lastFrame = frame;
  s.recent ??= new Float64Array(FAULT_BURST).fill(Number.NEGATIVE_INFINITY);
  const ring = s.recent;
  ring[s.faults % FAULT_BURST] = now;
  s.faults++;
  // the oldest of the last FAULT_BURST throws: all of them inside the window → a burst
  const oldest = ring[s.faults % FAULT_BURST] ?? Number.NEGATIVE_INFINITY;
  const burst = s.faults >= FAULT_BURST && now - oldest <= FAULT_WINDOW_MS;
  if (!s.core || (s.streak < FAULT_STREAK && !burst)) return 'retry';
  s.on = false;
  return 'fatal';
}

// ── the hub: the loop's state and every fault, for the reporter (src/client/engine/core/errorReport.ts) and the modal ──

/** 'boot': the world is still loading · 'running': the frame loop draws · 'dead': a core system died, the loop stopped */
export type LoopState = 'boot' | 'running' | 'dead';
let loop: LoopState = 'boot';
export function loopState(): LoopState { return loop; }
export function setLoopState(s: LoopState): void { loop = s; }

export interface Fault {
  /** the system's label ('window' for window.onerror / unhandledrejection, 'boot' for main().catch) */
  system: string;
  error: unknown;
  /** Recoverable frame failures use uncaught so they open the modal; fatal stops the loop. */
  verdict: FaultVerdict | 'uncaught';
}
type Listener = (f: Fault) => void;
const listeners = new Set<Listener>();
/** hear every fault; returns an unsubscribe */
export function onFault(fn: Listener): () => void { listeners.add(fn); const off = (): void => { listeners.delete(fn); }; onOwnerDispose(off); return off; }
export function emitFault(f: Fault): void {
  for (const fn of listeners) {
    try { fn(f); } catch (e) { console.error('[faults] a fault listener threw', e); } // a listener must never throw back into the loop
  }
}

/** Game.ts's catch: count it, log it once, tell the listeners. Returns the verdict (the loop stops on 'fatal'). */
export function systemFault(s: GameSystem<unknown>, error: unknown, frame: number, now: number): FaultVerdict {
  const verdict = recordFault(s, frame, now);
  if (s.faults === 1) console.error(`[faults] system "${s.label}" threw:`, error);
  if (verdict === 'fatal') {
    console.error(`[faults] core system "${s.label}" failed ${s.faults} times: the frame loop stops`);
    loop = 'dead'; // before the listeners hear it: the modal must not offer KEEP PLAYING on a loop that is stopping
  }
  if (s.faults === 1 || verdict === 'fatal') emitFault({ system: s.label, error, verdict: verdict === 'fatal' ? 'fatal' : 'uncaught' });
  return verdict;
}

/** A refused numeric observation; callers may isolate its owning frame while
 * keeping unrelated systems running. Admission still rejects the same input. */
export class NumericInputError extends Error {
  constructor(input: string, message = `Invalid numeric input ${input}`) { super(message); this.name = 'NumericInputError'; }
}

/** an error already described as text (main().catch hands the modal strings): reported as-is */
export class DescribedError {
  readonly message: string;
  readonly stack: string;
  constructor(message: string, stack: string) {
    this.message = message;
    this.stack = stack;
  }
}

/** `{ message, stack }` of anything thrown */
export function describeError(reason: unknown): { message: string; stack: string } {
  if (reason instanceof DescribedError) return { message: reason.message, stack: reason.stack };
  if (reason instanceof Error) return { message: `${reason.name}: ${reason.message}`, stack: reason.stack ?? '' };
  if (typeof reason === 'object' && reason !== null) { try { return { message: JSON.stringify(reason).slice(0, 400), stack: '' }; } catch { /* fall through */ } }
  return { message: String(reason), stack: '' };
}
