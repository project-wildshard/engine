import { PHONE_DRAW_LIMIT, PHONE_DRAW_CPU_US, renderCpuUsPerDraw, type DrawSample } from '../core/drawBudget';

/** Developer-only text in the existing perf panel; no throttle is inferred. */
export function drawBudgetCounter(sample: DrawSample, tier: string): string {
  const measured = Number.isSafeInteger(sample.draws) && sample.draws >= 0;
  const draws = measured ? String(sample.draws) : 'unmeasured';
  const us = renderCpuUsPerDraw(sample);
  const status = tier !== 'phone' ? 'phone gate only' : !measured ? 'unmeasured' : sample.draws > PHONE_DRAW_LIMIT ? 'OVER' : 'OK';
  return `DRAW BUDGET ${draws}/${PHONE_DRAW_LIMIT} ${status} · ${us === null ? 'n/a' : us.toFixed(1)} us/draw (unscaled; target ${PHONE_DRAW_CPU_US} at 4x)`;
}
