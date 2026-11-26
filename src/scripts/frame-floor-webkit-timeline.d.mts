/** The driving Inspector's protocol/event operations; no extra connection is opened. */
export interface TimelinePort {
  readonly clock?: object;
  readonly targetId?: string;
  readonly send: (method: string, params?: Readonly<Record<string, unknown>>) => Promise<unknown>;
  readonly on: (method: string, receive: (params: unknown) => void) => () => void;
}
export interface WebKitTimeline { readonly records: readonly unknown[]; readonly anchors: readonly (readonly [number, number])[]; readonly dropped?: number; readonly startedAt?: number; readonly endedAt?: number; readonly targetId?: string; readonly incomplete?: readonly string[]; readonly segments?: readonly WebKitTimeline[]; readonly garbageCollection?: { readonly available: boolean; readonly events: readonly unknown[]; readonly dropped: number } }
export class TimelineRecordingError extends Error { readonly timeline: WebKitTimeline; constructor(message: string, timeline: WebKitTimeline, cause: unknown); }
export interface TimelineFrame {
  readonly start: number; readonly ms: number; readonly idleMs: number; readonly busyMs: number; readonly afterRafMs: number;
  readonly tasksMs: number; readonly rafMs: number; readonly longestBusyMs: number; readonly verdict: string; readonly top: readonly string[];
}
export interface TimelineSummary {
  readonly segments?: readonly TimelineSummary[];
  readonly note?: string; readonly valid: boolean; readonly invalid: readonly string[]; readonly anchorDriftMs?: number; readonly renderingFrames?: number; readonly coverage?: number; readonly records?: number; readonly verdicts?: Readonly<Record<string, number>>;
  readonly totals?: Readonly<Record<string, number>>; readonly frames: readonly TimelineFrame[];
}
/** Start the shared Inspector clock once before Timeline or ScriptProfiler. */
export function ensureWebKitPageClock(inspector: TimelinePort): Promise<void>;
/** Enable Page's Inspector clock once per connection; refuse zero anchors before driving. Stop keeps raw records. */
export function startWebKitTimeline(inspector: TimelinePort, evaluate: (expression: string) => Promise<unknown>, signal?: AbortSignal): Promise<() => Promise<WebKitTimeline>>;
/** Every `ff-anchor:<page ms>` TimeStamp record as [timeline seconds, page ms]. */
export function timelineAnchors(records: readonly unknown[]): [number, number][];
/** Split each long frame ([startMs, ms, ...]) into idle, after-rAF rendering update, tasks and rAF callbacks. */
export function timelineLongFrames(timeline: WebKitTimeline, frames: readonly (readonly number[])[]): TimelineSummary;
