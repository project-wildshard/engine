// One checkout gate owns the lane; actual files share the machine CPU budget.
export const PUSH_PROFILE = 'full-v1';
export const PUSH_BUDGET = Object.freeze({policy:'admitted-v2', workers:10, builders:4, lintThreads:1, lintGo:1, v8Threads:1, reserve:2, warnSeconds:180});
