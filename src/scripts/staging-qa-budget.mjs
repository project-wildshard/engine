// Meta STAGING-QA SQ16, the budget every deploy check fits in. J427 (Jake 2026-11-18): "10 minutes local, and 10 minutes on
// release candidate. Include ~5mins of iOS simulator". J428: only the most obvious, stable checks (loads, reaches play, the
// world drew, the stick moves, no error card, load in budget, deep link, gate crossing), nothing that breaks on a content or
// feature change. Each leg lists its steps; each step names its cost on the MacBook and the one bug class only it catches.
// A leg over LEG_CAP_S is a P2 finding against the runner, never a pass at a quieter cap (RULES section 11).

/** @typedef {'local' | 'candidate' | 'staging'} LegKind */
/** @typedef {import('./staging-smoke/checks.mjs').Finding} Finding */

/** About 10 minutes a leg, capped at 12. */
export const LEG_TARGET_S = 600, LEG_CAP_S = 720;

/**
 * Nominal seconds per step, from the 2026-11-18 runs (v0.1.44 candidate and live, v0.1.45 local), rounded up to a clean pass.
 * @type {Readonly<Record<string, { seconds: number, catches: string }>>}
 */
export const STEPS = Object.freeze({
  build: { seconds: 120, catches: 'the release head does not build, sign or serve on loopback (pins, build-app, online rig)' },
  K1: { seconds: 60, catches: 'a saved Chromium cache that never reaches the new build' },
  K2: { seconds: 90, catches: 'a returning iPhone on Low Power and a 400 ms connection (SB48) that is slow, black or loses its save' },
  K3: { seconds: 60, catches: 'Driftwood from the title fails cold, on EXIT TO MAIN MENU and enter again, or warm from the worker' },
  K4: { seconds: 45, catches: 'a /slug/ deep link does not arrive in play' },
  K5: { seconds: 30, catches: 'the Infinite Wildshard grid entry does not arrive in play' },
  K6: { seconds: 210, catches: 'one Shard Select card draws a black world or never plays on WebKit iPhone at phone Low' },
  'gate-chromium': { seconds: 90, catches: 'walking through a cell gate does not arrive in the next cell' },
  doctor: { seconds: 45, catches: 'the signed build connection Doctor cannot reach staging rooms' },
  'read-only-webkit': { seconds: 30, catches: 'a fresh WebKit phone cannot reach the deep-link loader without writes' },
  // measured 55 s on staging v0.1.44 with the Simulator's boot; J428 keeps it to the obvious checks, so it uses ~2 of J427's ~5 minutes
  'ios-safari': { seconds: 120, catches: 'real iOS Safari (Simulator, real touch) does not reach a drawn world or move' },
});

/** The steps each leg runs by default. `staging` is SQ8's short re-run on live staging after the flip. The Simulator runs on
 * the local leg: its Safari uses the Mac's own network, which reaches the loopback rig but cannot be routed to the unaliased
 * candidate; `--only ios-safari` runs it on live staging. */
export const LEGS = Object.freeze(/** @type {const} */ ({
  local: ['build', 'K3', 'K4', 'K5', 'gate-chromium', 'ios-safari'],
  candidate: ['K1', 'K2', 'K5', 'K6'],
  staging: ['K3', 'K5'],
}));

/** Seconds the steps should take together. @param {readonly string[]} steps */
export function nominalSeconds(steps) {
  return steps.reduce((total, id) => total + (STEPS[id]?.seconds ?? 0), 0);
}

/** One line per step for --dry-run, then the leg's total against its target and cap. @param {LegKind} kind @param {readonly string[]} steps */
export function budgetLines(kind, steps) {
  const total = nominalSeconds(steps);
  return [
    ...steps.map(id => `  ${id.padEnd(14)} ~${String(STEPS[id]?.seconds ?? '?').padStart(3)} s  ${STEPS[id]?.catches ?? 'not budgeted'}`),
    `  ${kind} leg ~${(total / 60).toFixed(1)} min of ${String(LEG_TARGET_S / 60)} (cap ${String(LEG_CAP_S / 60)})`,
  ];
}

/** The runner's own finding when a leg ran past its cap, or undefined. @param {LegKind} kind @param {number} seconds
 * @returns {Finding | undefined} */
export function budgetFinding(kind, seconds) {
  if (seconds <= LEG_CAP_S) return undefined;
  return { scenario: 'runner', key: 'budget', severity: 'P2', source: 'check',
    text: `the ${kind} leg took ${(seconds / 60).toFixed(1)} min, over its ${String(LEG_CAP_S / 60)}-minute cap (J427)` };
}
