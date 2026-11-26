import { get, number, object, string } from './value.mjs';

/** Jake (E424, 2026-10-03): GPU memory never trips below 500 MB, on any shard, in CI or locally. The recorded gpuMB
 * ceilings stay as information; the enforced limit is never under this floor (the device limits are 1.8 GB / 1.0 GB). */
export const GPU_MB_FLOOR = 500;

/** Budget thresholds are class D. Metadata is information; pending/quarantine/ignore cannot hide a breach.
 * @param {import('./value.mjs').RecordValue} current */
export function budgetChecks(current) {
  const result = [];
  for (const [pose, value] of Object.entries(object(current.budgets))) {
    const spec = object(value), derived = object(spec.derived), ceiling = object(spec.ceiling);
    for (const metric of ['draws', 'tris', 'programs', 'gpuMB']) {
      const recorded = ceiling[metric] ?? derived[metric];
      if (recorded === undefined || recorded === null) continue;
      const limit = metric === 'gpuMB' ? Math.max(number(recorded), GPU_MB_FLOOR) : recorded;
      const path = metric === 'draws' ? `poses.${pose}.calls` : metric === 'tris' ? `poses.${pose}.tris` : metric === 'programs' ? 'boot.render.programs' : 'boot.gpuBytes.total';
      const specific = object(spec.observed)[metric];
      const observed = specific === undefined ? number(get(current, path)) / (metric === 'gpuMB' ? 2 ** 20 : 1) : number(specific);
      if ((metric === 'draws' || metric === 'tris') && current.poses === undefined) continue; // walk-only split
      result.push({ field: `budgets.${pose}.${metric}`, observed, limit: number(limit), pass: Number.isFinite(observed) && observed >= 0 && Number.isFinite(number(limit)) && number(limit) >= 0 && observed <= number(limit) });
    }
  }
  return result;
}
/** The fourth ND reference is a free camera, excluded from parity's standing poses (03 §3).
 * Budget-only frozen draws include it without advancing gameplay or adding systems/golden fields.
 * @param {import('playwright').Page} page
 * @param {boolean} [captureCurrent] Whether the shard has no standing parity poses. */
export function budgetViews(page, captureCurrent = false) {
  return page.evaluate(async (current) => {
    const w = window.__wildshard.requireWorld(), g = w.game, cameras = await g.level.capturePoses?.();
    /** @type {Record<string, { draws: number, tris: number, programs: number, gpuMB: number }>} */ const result = {};
    const position = g.camera.position.clone(), quaternion = g.camera.quaternion.clone();
    try {
      // A starter with no authored camera still needs measured counts for its current budget.
      const includeCurrent = current || Object.hasOwn(window.__wildshard.budgets([]), 'current');
      /** @type {Record<string, Awaited<ReturnType<NonNullable<typeof g.level.capturePoses>>>[string] | null>} */
      const views = { ...cameras, ...(includeCurrent ? { current: null } : {}) };
      for (const [name, c] of Object.entries(views)) {
        if (c === null) {
          g.shardFrame(); g.composer.render(0);
          g.renderer.info.reset(); g.composer.render(0);
          result[name] = { draws: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, programs: g.renderer.info.programs?.length ?? 0, gpuMB: (window.__wildshardHarness?.gpuBytes?.().total ?? Number.NaN) / 2 ** 20 };
          continue;
        }
        if (c.feet || c.probe) continue;
        g.camera.position.set(...c.eye); g.camera.rotation.set(c.pitch * Math.PI / 180, -c.yaw * Math.PI / 180, 0, 'YXZ'); g.shardFrame();
        g.composer.render(0); // settle uploads/programs with no simulation tick
        g.renderer.info.reset(); g.composer.render(0);
        result[name] = { draws: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, programs: g.renderer.info.programs?.length ?? 0, gpuMB: (window.__wildshardHarness?.gpuBytes?.().total ?? Number.NaN) / 2 ** 20 };
      }
    } finally { g.camera.position.copy(position); g.camera.quaternion.copy(quaternion); g.shardFrame(); g.renderer.info.reset(); g.composer.render(0); }
    return result;
  }, captureCurrent);
}
/** @param {import('./value.mjs').RecordValue} report */
export function budgetLines(report) {
  const budget = object(report.budgets);
  if (Object.keys(budget).length === 0) return ['Budgets: no calibration/ceiling inputs recorded yet.', ''];
  const lines = ['| Pose | Metric | Observed | Derived target | Enforced ceiling | Formula / inputs |', '|---|---|---|---|---|---|'];
  const checks = budgetChecks(report);
  for (const [pose, v] of Object.entries(budget)) {
    const spec = object(v), formulas = object(get(spec, 'formula.expressions'));
    for (const metric of ['draws', 'tris', 'programs', 'gpuMB']) {
      const check = checks.find((c) => c.field === `budgets.${pose}.${metric}`);
      const formula = string(formulas[metric]) || (object(spec.ceiling)[metric] !== undefined ? 'F2 baseline max(lanes) + recorded band; ratchet may only decrease' : 'not derived');
      lines.push(`| ${pose} | ${metric} | ${check?.observed ?? '—'} | ${JSON.stringify(object(spec.derived)[metric] ?? '—')} | ${check?.limit ?? '—'} | ${formula.replaceAll('|', String.raw`\|`)} |`);
    }
    lines.push('', `Inputs (${pose}): ${JSON.stringify(get(spec, 'formula.inputs') ?? null)}`, `Source: ${string(get(spec, 'formula.source'))}`, `Assumption: ${string(get(spec, 'formula.assumption'))}`, '');
  }
  return lines;
}
