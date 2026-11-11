// One checkout gate owns the lane; actual files share the machine CPU budget.
export const PUSH_PROFILE = 'full-v1';
export const PUSH_BUDGET = Object.freeze({policy:'admitted-v5', workers:10, vitestSlots:12, builders:4, cookSlots:2, lintThreads:1, lintGo:1, reserve:2, warnSeconds:180});
// DS9 (J222/J240): a split gate's exact-tree proof never stands in for a full one.
export const SPLIT_PROFILE = 'split-v1';
