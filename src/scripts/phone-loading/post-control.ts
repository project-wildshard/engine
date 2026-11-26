import type {Mark, RequestRow} from './model.ts';

/** Separate from tap-to-control accounting: an actually observed background window. */
export interface PostControl {
  start: number; end: number; requestedMs: number; observedMs: number; complete: boolean;
  longTaskMs: number | null; longTasks: Mark[]; requests: RequestRow[];
}

/** Clip work at both window edges. A failed or interrupted visit never becomes a complete zero-work reading. */
export function postControlWindow(control: number | null, observedAt: number, requestedMs: number,
  tasks: readonly Mark[], requests: readonly RequestRow[], longTasksSupported: boolean): PostControl | null {
  if (control === null) return null;
  if (![control, observedAt, requestedMs].every(Number.isFinite) || requestedMs < 0) throw new Error('Invalid post-control window');
  const end = Math.max(control, Math.min(observedAt, control + requestedMs));
  const overlap = (task: Mark): number => Math.max(0, Math.min(end, task.start + task.duration) - Math.max(control, task.start));
  const longTasks: Mark[] = [], selected: RequestRow[] = [];
  for (const task of tasks) if (overlap(task) > 0) longTasks.push({...task});
  for (const row of requests) if (row.start >= control && row.start < end) selected.push({...row});
  return {start: control, end, requestedMs, observedMs: end - control, complete: observedAt >= control + requestedMs,
    longTaskMs: longTasksSupported ? longTasks.reduce((sum, task) => sum + overlap(task), 0) : null, longTasks,
    requests: selected};
}
