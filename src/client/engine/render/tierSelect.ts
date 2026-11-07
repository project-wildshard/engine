import { gpuClass, DESKTOP_TFLOPS } from './gpuClasses';

export type SelectedTier = 'phone' | 'desktop';
export interface TierPick { v: 1; renderer: string; tier: SelectedTier; via: 'table' | 'bench'; score: number; at: number }
export interface TierChoice { tier: SelectedTier; via: 'harness' | 'setting' | 'mobile' | 'table' | 'bench' | 'unavailable'; detail: string; pick?: TierPick }
export function parseTierPick(value: unknown): TierPick | null {
  if (typeof value !== 'object' || value === null) return null;
  const v: unknown = Reflect.get(value, 'v'), renderer: unknown = Reflect.get(value, 'renderer'), tier: unknown = Reflect.get(value, 'tier'), via: unknown = Reflect.get(value, 'via'), score: unknown = Reflect.get(value, 'score'), at: unknown = Reflect.get(value, 'at');
  return v === 1 && typeof renderer === 'string' && (tier === 'phone' || tier === 'desktop') && (via === 'table' || via === 'bench') && typeof score === 'number' && Number.isFinite(score) && score >= 0 && typeof at === 'number' && Number.isFinite(at) ? { v, renderer, tier, via, score, at } : null;
}
export async function selectTier(options: {
  harness?: SelectedTier; preference?: SelectedTier; mobile: boolean; renderer: () => string;
  cached: TierPick | null; benchmark: () => Promise<number>; desktopFloor: number; now: () => number;
}): Promise<TierChoice> {
  if (options.harness) return { tier: options.harness, via: 'harness', detail: 'Harness override' };
  if (options.preference) return { tier: options.preference, via: 'setting', detail: 'Quality setting' };
  if (options.mobile) return { tier: 'phone', via: 'mobile', detail: 'Phone or tablet' };
  const renderer = options.renderer(), cached = options.cached;
  if (cached?.renderer === renderer) return { tier: cached.tier, via: cached.via, detail: `Cached ${cached.via} · ${cached.score}`, pick: cached };
  const row = gpuClass(renderer);
  const via = row ? 'table' : 'bench';
  const score = row?.tflops ?? await options.benchmark();
  if (!Number.isFinite(score) || score <= 0 || !Number.isFinite(options.desktopFloor) || options.desktopFloor <= 0) throw new Error('Tier selection needs positive measured throughput');
  const tier = score >= (row ? DESKTOP_TFLOPS : options.desktopFloor) ? 'desktop' : 'phone';
  const pick: TierPick = { v: 1, renderer, tier, via, score, at: options.now() };
  return { tier, via, detail: row ? `${row.model} · ${row.tflops} TFLOPS` : `${score.toFixed(1)} passes/s · floor ${options.desktopFloor.toFixed(1)} (3060 projection)`, pick };
}
