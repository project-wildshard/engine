import { normalize } from './compare.mjs';
import { get, number, object, string } from './value.mjs';

/** Baseline ceilings use the greater value plus its existing noise band from either lane.
 * Missing runner baselines are explicit provenance, never invented measurements.
 * @param {import('./value.mjs').RecordValue[]} baselines */
export function baselineCeilings(baselines) {
  /** @type {Record<string, number>} */ const result = {};
  for (const raw of baselines) {
    const b = normalize(raw), slug = string(get(b, 'boot.shard')), tier = string(get(b, 'boot.tier'));
    if (!slug || !tier) throw new Error('Ceiling baseline needs boot.shard and boot.tier');
    const views = Object.entries(object(b.budgets)).filter(([, value]) => Object.keys(object(object(value).observed)).length > 0).map(([name]) => name);
    const names = new Set([...Object.keys(object(b.poses)), ...views]);
    // A starter shard may have no pinned poses yet; its boot still measures GL bytes/programs.
    if (names.size === 0) names.add('current');
    for (const pose of names) {
      const paths = { draws: `poses.${pose}.calls`, tris: `poses.${pose}.tris`, programs: 'boot.render.programs', gpuMB: 'boot.gpuBytes.total' };
      for (const [metric, path] of Object.entries(paths)) {
        if (!Object.hasOwn(object(b.poses), pose) && !views.includes(pose) && (metric === 'draws' || metric === 'tris')) continue;
        const observed = get(b, `budgets.${pose}.observed.${metric}`), v = observed === undefined ? number(get(b, path)) : number(observed) * (metric === 'gpuMB' ? 2 ** 20 : 1);
        const spread = number(object(b.spread)[observed === undefined ? path : `budgets.${pose}.observed.${metric}`] ?? 0) * (observed !== undefined && metric === 'gpuMB' ? 2 ** 20 : 1);
        if (!Number.isFinite(v) || v < 0 || !Number.isFinite(spread) || spread < 0) throw new Error(`Missing/invalid ${slug}.${tier}.${path}`);
        const band = 2 * spread; // the compare's band (E388: no invented floor on top)
        const ceiling = (v + band) / (metric === 'gpuMB' ? 2 ** 20 : 1), key = `${slug}.${tier}.${pose}.${metric}`;
        result[key] = Math.max(result[key] ?? 0, metric === 'gpuMB' ? ceiling : Math.ceil(ceiling));
      }
    }
  }
  return result;
}
