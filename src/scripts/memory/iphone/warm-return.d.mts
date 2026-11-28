/** RunningBoard's visible WebContent pid at each moment: [local clock "HH:MM:SS.mmm", pid] in log order. */
export function visibleTimeline(lines: string[]): [string, number][];
/** The visible pid at a host time, from a timeline on the phone's local clock. */
export function visibleAt(timeline: [string, number][], when: Date): number | null;
/** The kernel's WebContent kills in the device log: [local clock, pid, resident KB or null, the kernel's words]. */
export function kernelKills(lines: string[]): [string, number, number | null, string][];
/** An arm's device slots from `--slot key=value`: the value is JSON when it parses, else the text. */
export function parseSlots(list: string[]): Record<string, unknown>;
/** Each loading stage's longest finished span in ms (`stage:shaders` -> `shaders`) from boot timing rows. */
export function stageSpans(entries: unknown): Record<string, number>;
