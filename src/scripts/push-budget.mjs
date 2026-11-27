// One checkout gate owns the lane; actual files share the machine CPU budget.
export const PUSH_PROFILE = 'full-v1';
export const PUSH_BUDGET = Object.freeze({policy:'admitted-v5', workers:6, builders:4, cookSlots:2, lintThreads:1, lintGo:1, reserve:2, warnSeconds:180});
// DS9 (J222/J240): a split gate's exact-tree proof never stands in for a full one.
export const SPLIT_PROFILE = 'split-v1';

/** The gate supplies a validated worker limit to Vitest and its CPU broker. */
export const pushWorkers = (env = process.env) => Number(env.WS_VITEST_MAX_WORKERS ?? PUSH_BUDGET.workers);
