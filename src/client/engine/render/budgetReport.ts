import { deriveBudget, type BudgetInputs, type BudgetLimits } from './budgets';
import { parseCalibration, record } from './calibration';
import ratchetText from '../../../../lint/ratchet.json?raw';

export interface PoseBudget {
  derived: BudgetLimits | null; ceiling: Partial<Record<keyof BudgetLimits, number>> | null;
  formula: { inputs: BudgetInputs; source: string; assumption: string; expressions?: Record<string, string> };
  systemMs?: Record<string, number>; gpuM5Ms?: number; downloadBytes?: number | null;
}
// The optional current file is published by calibrate.mjs only after its thermal convergence check.
const files = import.meta.glob<string>('../../../../budgets/calibration.json', { eager: true, query: '?raw', import: 'default' });
const raw = Object.values(files)[0];
const calibration = raw === undefined ? null : parseCalibration(raw);
const ceilings = record(record(JSON.parse(ratchetText) as unknown)['budgets']);
export function poseBudgets(id: string, tier: 'phone' | 'desktop', inputs: BudgetInputs, poses: readonly string[]): Record<string, PoseBudget> {
  const d = calibration === null ? null : deriveBudget(inputs, tier, calibration);
  const authored = inputs.ceilings?.[tier] ?? {};
  const names = new Set([...poses, ...Object.keys(authored)]);
  // Includes ceilings on walk-only harness parts without introducing a content-name table.
  const prefix = `${id}.${tier}.`;
  for (const key of Object.keys(ceilings)) if (key.startsWith(prefix)) { const pose = key.slice(prefix.length).split('.')[0]; if (pose) names.add(pose); }
  return Object.fromEntries([...names].map((pose) => {
    const ceiling: Partial<Record<keyof BudgetLimits, number>> = {};
    for (const metric of ['draws', 'tris', 'programs', 'gpuMB'] as const) {
      const n = authored[pose]?.[metric] ?? ceilings[`${id}.${tier}.${pose}.${metric}`] ?? ceilings[`${id}.${tier}.${metric}`];
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) ceiling[metric] = n;
      // Programs and GL bytes are boot-wide measurements, reused by an unrecorded free-camera view.
      if (ceiling[metric] === undefined && (metric === 'programs' || metric === 'gpuMB')) {
        const ownBootLimits = Object.values(authored).map((row) => row[metric]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);
        const bootLimits = ownBootLimits.length > 0 ? ownBootLimits : Object.entries(ceilings).filter(([k]) => k.startsWith(prefix) && k.endsWith(`.${metric}`)).map(([, v]) => v).filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);
        if (bootLimits.length > 0) ceiling[metric] = Math.max(...bootLimits);
      }
    }
    return [pose, { derived: d?.limits ?? null, ceiling: Object.keys(ceiling).length > 0 ? ceiling : null,
      formula: d?.formula ?? { inputs, source: calibration === null ? 'No published calibration; F2 ceilings until the quiet M5 publishing run' : calibration.source,
        assumption: calibration?.phone.assumption ?? 'Hot phone = M5 ×10 assumption (E283); current stable M5 calibration is not yet published' },
      ...d ? { systemMs: d.systemsMs, gpuM5Ms: d.gpuM5Ms, downloadBytes: d.downloadBytes } : {} }];
  }));
}

/** Jake (E424, 2026-10-03): GPU memory never trips below 500 MB; the recorded gpuMB ceilings stay as information. */
export const GPU_MB_FLOOR = 500;

/** Live readouts have no pinned pose; report the largest allowed recorded pose rather than a universal constant. */
export function frameBudget(id: string, tier: 'phone' | 'desktop', inputs: BudgetInputs): BudgetLimits {
  const rows = Object.values(poseBudgets(id, tier, inputs, ['current']));
  const max = (metric: keyof BudgetLimits): number | null => {
    const limits = rows.map((row) => row.ceiling?.[metric] ?? row.derived?.[metric]).filter((n): n is number => typeof n === 'number');
    return limits.length === 0 ? null : Math.max(...limits);
  };
  const gpu = max('gpuMB');
  return { draws: max('draws'), tris: max('tris'), programs: max('programs'), gpuMB: gpu === null ? null : Math.max(gpu, GPU_MB_FLOOR) };
}
