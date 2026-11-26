/** Install the opt-in task clock in a page (`frame-floor.mjs --task-clock`); tasks under `minMs` total are dropped. */
export function installTaskClock(minMs?: number, cap?: number): void;
/** The page initializer `frame-floor.mjs` emits when `--task-clock` is on. */
export const TASK_CLOCK_SCRIPT: string;
