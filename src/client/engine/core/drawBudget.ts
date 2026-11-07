/** EP10: whole-frame submission, including shadow, post and held passes.
 * CPU is the matching Game.renderMs sample, never GPU time or update work. */
export const PHONE_DRAW_LIMIT = 150;
export const PHONE_DRAW_CPU_US = 30;

export interface DrawSample { readonly draws: number; readonly renderMs: number }
export function renderCpuUsPerDraw(sample: DrawSample): number | null {
  if (!Number.isSafeInteger(sample.draws) || sample.draws <= 0 || !Number.isFinite(sample.renderMs) || sample.renderMs < 0) return null;
  const us = sample.renderMs * 1000 / sample.draws;
  return Number.isFinite(us) ? us : null;
}

export interface DrawBudgetAssessment {
  applied: boolean; cpuApplied: boolean; samples: number; validDrawSamples: number; validCpuSamples: number;
  maxDraws: number | null; maxRenderCpuUsPerDraw: number | null;
  /** Pooled paired-frame CPU / draws; diagnostic beside the unchanged worst-frame gate. */
  meanRenderCpuUsPerDraw: number | null;
  drawLimit: number; cpuLimitUs: number; drawsPass: boolean | null; cpuPass: boolean | null;
  pass: boolean; miss: string | null;
}

/** Gate every observed frame of a phone pose. CPU acceptance needs actual 4x
 * measurement; a 1x or Simulator reading is never extrapolated to that clock. */
export function assessDrawBudget(samples: readonly DrawSample[] | undefined, frames: number,
  context: { readonly tier: string; readonly cpuRate: number }): DrawBudgetAssessment {
  let validDrawSamples = 0, validCpuSamples = 0, maxDraws: number | null = null, maxRenderCpuUsPerDraw: number | null = null;
  let totalDraws = 0, totalRenderMs = 0;
  for (const sample of samples ?? []) {
    if (Number.isSafeInteger(sample.draws) && sample.draws >= 0) {
      validDrawSamples++; maxDraws = Math.max(maxDraws ?? 0, sample.draws);
    }
    const us = renderCpuUsPerDraw(sample);
    if (us !== null) {
      validCpuSamples++; maxRenderCpuUsPerDraw = Math.max(maxRenderCpuUsPerDraw ?? 0, us);
      totalDraws += sample.draws; totalRenderMs += sample.renderMs;
    }
  }
  const count = samples?.length ?? 0, complete = Number.isSafeInteger(frames) && frames > 0 && count === frames;
  const pooled = totalRenderMs * 1000 / totalDraws;
  const meanRenderCpuUsPerDraw = complete && validCpuSamples === count && Number.isSafeInteger(totalDraws) && totalDraws > 0 && Number.isFinite(pooled) ? pooled : null;
  const applied = context.tier === 'phone', cpuApplied = applied && context.cpuRate === 4;
  const drawsPass = applied ? complete && validDrawSamples === count && maxDraws !== null && maxDraws <= PHONE_DRAW_LIMIT : null;
  const cpuPass = cpuApplied ? complete && validCpuSamples === count && maxRenderCpuUsPerDraw !== null && maxRenderCpuUsPerDraw <= PHONE_DRAW_CPU_US : null;
  const miss = drawsPass === false ? !complete || validDrawSamples !== count ? 'missing whole-frame draw samples' : `draw budget: ${maxDraws} > ${PHONE_DRAW_LIMIT}`
    : cpuPass === false ? validCpuSamples !== count ? 'missing paired render CPU/draw samples' : `render CPU/draw: ${maxRenderCpuUsPerDraw} us > ${PHONE_DRAW_CPU_US} us at 4x` : null;
  return { applied, cpuApplied, samples: count, validDrawSamples, validCpuSamples, maxDraws, maxRenderCpuUsPerDraw, meanRenderCpuUsPerDraw,
    drawLimit: PHONE_DRAW_LIMIT, cpuLimitUs: PHONE_DRAW_CPU_US, drawsPass, cpuPass, pass: miss === null, miss };
}
