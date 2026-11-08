// One full push owns the machine lane; ordinary focused runs keep their smaller pool.
export const PUSH_PROFILE = 'full-v1';
export const PUSH_BUDGET = Object.freeze({workers:10, builders:4, lintThreads:1, lintGo:1, reserve:2, warnSeconds:180});
