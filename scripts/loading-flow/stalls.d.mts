import type { CDPSession, Page } from 'playwright';

/** One boot timeline entry as `__bootTiming` keeps it. */
export interface StallEntry { operation: string; realm: string; start: number; end: number | null }
/** One idle profile sample on the page clock: its time and its length (ms). */
export interface IdleSample { at: number; ms: number }
/** A stage's worst window: its unexplained idle (ms) and where the window starts in the stage. */
export interface StageStall { stage: string; from: number; idleMs: number; stageMs: number }

/** The window a stall is judged over (ms). */
export const STALL_WINDOW_MS: number;
/** The share of the window unexplained idle must reach to be a stall. */
export const STALL_IDLE_SHARE: number;
/** The load stages the ring-1 ratchet holds. */
export const STALL_STAGES: readonly string[];
/** Each listed stage's worst window of idle main thread with no page `wait:` entry open. */
export function stageStalls(entries: readonly StallEntry[], idle: readonly IdleSample[], stages?: readonly string[]): StageStall[];
/** Stage stalls at or over the share, as fault lines. */
export function stallFaults(entries: readonly StallEntry[], idle: readonly IdleSample[]): string[];
/** A Chromium CPU profile's idle samples on the page clock, from the page time read just before the stop. */
export function profileIdle(profile: { nodes: readonly { id: number; callFrame: { functionName: string } }[]; samples?: readonly number[]; timeDeltas?: readonly number[]; startTime: number; endTime: number }, pageEnd: number): IdleSample[];
/** Browser-side: the page's boot timeline entries. */
export function bootTimelineEntries(): StallEntry[];
/** Start a stall profile of the page (Chromium only, else null). */
export function startStallProfile(page: Page): Promise<CDPSession | null>;
/** End a stall profile at control: the ratcheted stages' worst windows and their faults. */
export function finishStallProfile(page: Page, session: CDPSession): Promise<{ stalls: StageStall[]; faults: string[] }>;
