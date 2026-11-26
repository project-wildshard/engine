// GRID-CROSSING GC3: the per-pair ratchet (`test/grid-crossing-ratchet.json`). Each crossing run (site, browser and layout, from
// cell to cell) keeps its best-known numbers; a later run may only match or beat them, within a noise allowance. Tightening only
// ever lowers a number (or turns a failed pair into a passing one), so the ratchet moves toward the goal table and never back.

/** The measures a pair is held to, and the noise a run may add before it counts as worse. */
export const MEASURES = /** @type {const} */ ({ borderToControlMs: { slack: 1500, factor: 1.5 }, freezeMs: { slack: 500, factor: 1.5 }, wallMs: { slack: 500, factor: 1.5 }, over50: { slack: 3, factor: 1.5 } });

/** @typedef {{ ok: boolean, borderToControlMs?: number | null, freezeMs?: number | null, wallMs?: number | null, over50?: number | null }} PairNumbers */
/** @typedef {Record<string, PairNumbers>} Ratchet */

/** The ratchet key of one crossing. @param {string} site @param {string} run @param {string} from @param {string} to */
export const pairKey = (site, run, from, to) => `${site}/${run}/${from}:${to}`;

/**
 * What got worse than the ratchet: a pair that passed now fails, or a measure past `max(held × factor, held + slack)`. A pair the
 * ratchet doesn't hold, or a run that didn't try a held pair, is not worse (a partial run passes).
 * @param {Ratchet} ratchet @param {Record<string, PairNumbers>} now @returns {{ key: string, measure: string, held: unknown, now: unknown }[]}
 */
export function worse(ratchet, now) {
  /** @type {{ key: string, measure: string, held: unknown, now: unknown }[]} */
  const found = [];
  for (const [key, run] of Object.entries(now)) {
    const held = ratchet[key];
    if (held === undefined) continue;
    if (held.ok && !run.ok) { found.push({ key, measure: 'ok', held: true, now: false }); continue; }
    if (!run.ok) continue;
    for (const [measure, { slack, factor }] of Object.entries(MEASURES)) {
      const was = held[/** @type {keyof PairNumbers} */ (measure)], is = run[/** @type {keyof PairNumbers} */ (measure)];
      if (typeof was !== 'number' || typeof is !== 'number') continue;
      if (is > Math.max(was * factor, was + slack)) found.push({ key, measure, held: was, now: is });
    }
  }
  return found;
}

/** The ratchet after a run: new pairs join, a pair that now passes is held to passing, and each measure only goes down. @param {Ratchet} ratchet @param {Record<string, PairNumbers>} now @returns {Ratchet} */
export function tighten(ratchet, now) {
  /** @type {Ratchet} */
  const next = { ...ratchet };
  for (const [key, run] of Object.entries(now)) {
    const held = next[key];
    if (held === undefined || (!held.ok && run.ok)) { next[key] = { ...run }; continue; }
    if (!run.ok) continue;
    /** @type {PairNumbers} */ const kept = { ...held };
    for (const measure of Object.keys(MEASURES)) {
      const name = /** @type {'borderToControlMs' | 'freezeMs' | 'wallMs' | 'over50'} */ (measure), was = held[name], is = run[name];
      if (typeof is === 'number' && (typeof was !== 'number' || is < was)) kept[name] = is;
    }
    next[key] = kept;
  }
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
}
