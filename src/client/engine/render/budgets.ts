/** E357 S1.6: pure device-cost arithmetic. Counts never stand in for shader time. */
export interface TierBudgetInputs {
  fps: number; variability: number; cpuMs: number; gcMs: number;
  systems: Readonly<Record<string, number>>;
  vertexShare: number; lanes: Readonly<Record<string, number>>;
  linkMs: number;
}
export type BudgetCeilings = Partial<Record<'phone' | 'desktop', Readonly<Record<string, Partial<Record<keyof BudgetLimits, number>>>>>>;
export interface BudgetInputs {
  /** Authored rollout maxima, copied unchanged from recorded F2 evidence. */
  ceilings?: BudgetCeilings;
  phone?: TierBudgetInputs; desktop?: TierBudgetInputs;
  load?: { coldPlay4G: number | null; fixedSeconds: number; cpuRatio: number; bytesPerSecond: number };
}
export interface CalibrationCosts {
  drawCpuMs: number; triangleGpuMs: Record<'static' | 'skinned' | 'wind', number>;
  fragmentGpuMs: Record<'flat' | 'toon' | 'pbr' | 'alphaTest' | 'blend', number>;
  passGpuMs: Record<string, number>; linkMs: number; rigCpuMs: number; bodyCpuMs: number; agentCpuMs: number;
}
export interface Calibration {
  schema: 1; measuredAt: string; device: string; source: string;
  phone: { ratio: number; source: string; assumption: string };
  desktop?: { k3060: number; source: string; assumption: string };
  rtx3060?: { costs: CalibrationCosts; source: string };
  tierSelection?: { m5Score: number; source: string };
  combine: 'serial' | 'pipelined'; costs: CalibrationCosts;
}
export interface BudgetLimits { draws: number | null; tris: number | null; programs: number | null; gpuMB: number | null }
export interface DerivedBudget {
  limits: BudgetLimits; frameMs: number; gpuMs: number; gpuM5Ms: number;
  systemsMs: Record<string, number>; entities: { rigs: number; bodies: number; agents: number };
  lanesMs: Record<string, number>; downloadBytes: number | null;
  formula: { inputs: BudgetInputs; source: string; assumption: string; expressions: Record<string, string> };
}
function positive(n: number, name: string): number {
  if (!Number.isFinite(n) || n <= 0) throw new RangeError(`Budget ${name} must be positive`);
  return n;
}
export function deriveBudget(inputs: BudgetInputs, tier: 'phone' | 'desktop', calibration: Calibration): DerivedBudget | null {
  const i = inputs[tier];
  if (!i) return null;
  if (tier === 'desktop' && !calibration.desktop && !calibration.rtx3060) return null;
  const nativeDesktop = tier === 'desktop' ? calibration.rtx3060 : undefined;
  const ratio = tier === 'phone' ? positive(calibration.phone.ratio, 'ratio') : nativeDesktop ? 1 : 1 / positive(calibration.desktop?.k3060 ?? 0, 'k3060');
  const c = nativeDesktop?.costs ?? calibration.costs;
  const source = nativeDesktop?.source ?? (tier === 'desktop' ? calibration.desktop?.source : calibration.source) ?? calibration.source;
  const assumption = tier === 'desktop' ? nativeDesktop ? 'Measured RTX 3060 calibration' : calibration.desktop?.assumption ?? '' : calibration.phone.assumption;
  const frameMs = 1000 / positive(i.fps, 'fps') / positive(i.variability, 'variability');
  const cpuMs = positive(i.cpuMs, 'cpuMs');
  const systemMs = Object.values(i.systems).reduce((sum, v) => sum + v, 0);
  const lanes = Object.values(i.lanes);
  if (Object.values(i.systems).some((v) => !Number.isFinite(v) || v < 0) || !Number.isFinite(i.gcMs) || i.gcMs < 0 || systemMs + i.gcMs >= cpuMs || cpuMs >= frameMs || !Number.isFinite(i.vertexShare) || i.vertexShare <= 0 || i.vertexShare >= 1 || lanes.some((v) => !Number.isFinite(v) || v < 0) || lanes.reduce((a, b) => a + b, 0) > 1.000001) throw new RangeError('Invalid budget allocation');
  positive(i.linkMs, 'link allocation');
  const gpuMs = calibration.combine === 'serial' ? frameMs - cpuMs : frameMs;
  const drawMs = positive(c.drawCpuMs, 'draw cost') * ratio;
  const triMs = positive(c.triangleGpuMs.static, 'triangle cost') * ratio;
  const linkMs = positive(c.linkMs, 'link cost') * ratio;
  const load = inputs.load;
  const downloadBytes = load?.coldPlay4G === null || load === undefined ? null : Math.floor(Math.max(0, load.coldPlay4G - load.fixedSeconds * load.cpuRatio) * load.bytesPerSecond);
  const capacity = (budget: number, unit: number): number => Math.floor(budget / positive(unit * ratio, 'entity cost'));
  return {
    limits: { draws: Math.floor((cpuMs - systemMs - i.gcMs) / drawMs), tris: Math.floor(gpuMs * i.vertexShare / triMs), programs: Math.floor(i.linkMs / linkMs), gpuMB: null },
    frameMs, gpuMs, gpuM5Ms: nativeDesktop ? gpuMs * calibration.costs.triangleGpuMs.static / c.triangleGpuMs.static : gpuMs / ratio, systemsMs: { ...i.systems },
    entities: { rigs: capacity(i.systems['animation'] ?? 0, c.rigCpuMs), bodies: capacity(i.systems['physics'] ?? 0, c.bodyCpuMs), agents: capacity(i.systems['ai'] ?? 0, c.agentCpuMs) },
    lanesMs: Object.fromEntries(Object.entries(i.lanes).map(([k, share]) => [k, gpuMs * share])), downloadBytes,
    formula: { inputs, source, assumption,
      expressions: { frame: `1000 / ${i.fps} / ${i.variability}`, gpu: calibration.combine === 'serial' ? `${frameMs} - ${cpuMs}` : `${frameMs} (pipelined)`,
        draws: `floor((${cpuMs} - ${systemMs} - ${i.gcMs}) / (${c.drawCpuMs} × ${ratio}))`, tris: `floor(${gpuMs} × ${i.vertexShare} / (${c.triangleGpuMs.static} × ${ratio}))`,
        programs: `floor(${i.linkMs} / (${c.linkMs} × ${ratio}))`, gpuMB: 'GL bytes retain measured baseline ceiling; native footprint is a separate Simulator gate',
        downloadBytes: load ? `(${String(load.coldPlay4G)} - ${load.fixedSeconds} × ${load.cpuRatio}) × ${load.bytesPerSecond}` : 'no load inputs' } },
  };
}
