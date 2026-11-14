import type { CDPSession, Page } from 'playwright';

/** One boot timeline entry as `__bootTiming` keeps it. */
export interface StallEntry { operation: string; realm: string; start: number; end: number | null }
/** An idle stretch on the page clock (ms). */
export interface Span { start: number; end: number }
/** A stage's worst window: its unexplained idle (ms) and where the window starts in the stage. */
export interface StageStall { stage: string; from: number; idleMs: number; stageMs: number }
/** A Chromium CPU profile, as `Profiler.stop` returns it. */
export interface CpuProfile { nodes: readonly { id: number; callFrame: { functionName: string; url?: string } }[]; samples?: readonly number[]; timeDeltas?: readonly number[]; startTime: number; endTime: number }

/** The window a stall is judged over (ms). */
export const STALL_WINDOW_MS: number;
/** The share of the window unexplained idle must reach to be a stall. */
export const STALL_IDLE_SHARE: number;
/** The load stages the ring-1 ratchet holds. */
export const STALL_STAGES: readonly string[];
/** The page function the clock mark runs, by this name in the profile. */
export const CLOCK_MARK: string;
/** The page expression that runs the clock mark and returns its start on the page clock. */
export const CLOCK_MARK_EXPRESSION: string;
/** Idle spans merged, minus holes, cut to [from, to]. */
export function idleWithin(spans: readonly Span[], holes: readonly Span[], from: number, to: number): Span[];
/** The most of the spans inside any window of `width`, and where that window starts. */
export function busiestWindow(spans: readonly Span[], width: number): { at: number; ms: number };
/** Each listed stage's worst window of idle main thread with no page `wait:` entry open. */
export function stageStalls(entries: readonly StallEntry[], idle: readonly Span[], stages?: readonly string[]): StageStall[];
/** Stage stalls at or over the share, as fault lines. */
export function stallFaults(entries: readonly StallEntry[], idle: readonly Span[]): string[];
/** Where the profile's clock meets the page's, from the clock mark's first sample. */
export function profileAnchor(profile: CpuProfile, markPageMs: number): { pageMs: number; profileUs: number };
/** A Chromium CPU profile's idle stretches on the page clock. */
export function profileIdle(profile: CpuProfile, anchor: { pageMs: number; profileUs: number }): Span[];
/** Browser-side: the page's boot timeline entries. */
export function bootTimelineEntries(): StallEntry[];
/** Start a stall profile of the page (Chromium only, else null). */
export function startStallProfile(page: Page): Promise<CDPSession | null>;
/** End a stall profile at control: the ratcheted stages' worst windows and their faults. */
export function finishStallProfile(page: Page, session: CDPSession): Promise<{ stalls: StageStall[]; faults: string[] }>;
/** NB6, play: a stretch of live frames' worst window of unbroken main-thread work (ms), where it starts, and play's length. */
export interface PlayStall { from: number; busyMs: number; playMs: number }
/** The share of the window unbroken main-thread work must reach to be a play stall. */
export const PLAY_BUSY_SHARE: number;
/** A profile's main-thread work on the page clock: neither idle, `(program)`, nor a WebGL call's native leaf. */
export function profileBusy(profile: CpuProfile, anchor: { pageMs: number; profileUs: number }): Span[];
/** Play's worst window of [from, to]. */
export function playStall(busy: readonly Span[], from: number, to: number): PlayStall;
/** A play stall at or over the share, as a fault line. */
export function playStallFaults(stall: PlayStall): string[];
/** End a play profile: play's worst window from `fromPageMs` and its fault. */
export function finishPlayProfile(page: Page, session: CDPSession, fromPageMs: number): Promise<{ stall: PlayStall; faults: string[] }>;
