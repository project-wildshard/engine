import { appendFileSync, writeFileSync } from 'node:fs';
import { assessDrawBudget, PHONE_DRAW_LIMIT, PHONE_DRAW_CPU_US } from '../src/client/engine/core/drawBudget.ts';

/** @param {(number|null)[]} values */
const maximum = values => values.reduce((max, value) => value === null ? max : Math.max(max ?? value, value), /** @type {number|null} */ (null));
/** @param {import('./frame-floor-draw-report.mjs').DrawReportStatus[]} statuses
 * @returns {import('./frame-floor-draw-report.mjs').DrawReportStatus} */
function statusOf(statuses) {
  if (statuses.length === 0 || statuses.includes('INCOMPLETE')) return 'INCOMPLETE';
  if (statuses.includes('MISS')) return 'MISS';
  return statuses.includes('NOT MEASURED') ? 'NOT MEASURED' : 'PASS';
}

/** Reassess raw paired frames, including on regrade: never trust a stale verdict
 * or extrapolate a Simulator/1x clock into the Chromium 4x CPU budget.
 * @param {import('./frame-floor-draw-report.mjs').FloorDrawRecord} record
 * @returns {import('./frame-floor-draw-report.mjs').FloorDrawReport} */
export function frameFloorDrawReport(record) {
  /** @type {import('./frame-floor-draw-report.mjs').FloorDrawPose[]} */
  const poses = [];
  /** @type {import('./frame-floor-draw-report.mjs').FloorDrawShard[]} */
  const shards = [];
  const surfaces = record.surface === 'both' ? ['desktop', 'sim'] : record.surface === undefined ? [...new Set(record.results.map(row => row.surface))] : [record.surface];
  for (const surface of surfaces) {
    const readings = record.results.filter(row => row.surface === surface).flatMap(row => row.rows);
    const selected = record.shards ?? [...new Set(readings.map(row => row.shard))];
    for (const shard of selected) {
      const matches = readings.filter(row => row.shard === shard), reading = matches[0];
      const tier = reading?.metadata?.settings?.tier ?? record.settings?.tier ?? (surface === 'sim' ? 'phone' : 'desktop');
      const phased = surface === 'desktop' && record.cpuPhaseMode === 'after-ready';
      const software = record.softwareCensus !== undefined;
      const cpuRate = surface === 'desktop' ? phased ? reading?.cpuPhase?.measuredRate ?? 1 : record.chromiumCpuRate ?? 1 : 1;
      const rows = (reading?.rows ?? []).map((row, index) => {
        const budget = assessDrawBudget(row.drawSamples, row.frames, { tier: software ? 'software-diagnostic' : tier, cpuRate });
        const softwareValid = !software || phased && record.chromiumCpuRate === 4 && record.chromiumAngleExplicit === true
          && record.drawBudgetMode === 'report-only' && record.chromiumAngle === 'swiftshader' && surface === 'desktop'
          && record.softwareCensus?.scope === 'spawn-only' && record.softwareCensus.frames === 4
          && record.softwareCensus.viewport.width === 201 && record.softwareCensus.viewport.height === 437
          && reading?.metadata?.renderer?.startsWith('ANGLE (') === true && reading.metadata.renderer.includes('SwiftShader')
          && reading.metadata.viewport?.join(',') === '201,437' && reading.metadata.canvas?.join(',') === '402,874'
          && reading.metadata.renderScale === 2 && reading.rows?.length === 1 && row.pose?.name === 'spawn' && row.frames === 4;
        const phase = reading?.cpuPhase, fence = phase?.fence;
        const phaseValid = !phased || record.bootCpuRate === 1 && phase?.bootRate === 1
          && phase.requestedRate === record.chromiumCpuRate && phase.measuredRate === record.chromiumCpuRate
          && fence !== null && fence !== undefined && Number.isSafeInteger(fence.frame) && fence.frame >= 0
          && Number.isSafeInteger(fence.firstCompletedFrame) && fence.firstCompletedFrame >= fence.frame + 2
          && Number.isFinite(fence.atMs) && fence.atMs >= 0 && Number.isFinite(fence.documentOrigin) && fence.documentOrigin > 0
          && row.sampleRange !== undefined && row.sampleRange.startMs >= fence.atMs
          && row.drawSamples !== undefined && row.drawSamples.every(sample => Number.isSafeInteger(sample.drawnFrame) && (sample.drawnFrame ?? -1) > fence.firstCompletedFrame);
        const coverage = phaseValid && softwareValid && Number.isSafeInteger(row.frames) && row.frames > 0 && budget.samples === row.frames
          && budget.validDrawSamples === row.frames && (!(budget.cpuApplied || software) || budget.validCpuSamples === row.frames);
        /** @type {import('./frame-floor-draw-report.mjs').DrawReportStatus} */
        const status = !coverage ? 'INCOMPLETE' : budget.drawsPass === false || budget.cpuPass === false ? 'MISS'
          : !budget.applied || !budget.cpuApplied ? 'NOT MEASURED' : 'PASS';
        return { surface, shard, pose: row.pose?.name ?? `row-${index + 1}`, tier: software ? 'software-diagnostic' : tier, cpuRate, frames: row.frames, status, budget };
      });
      poses.push(...rows);
      const status = matches.length !== 1 || reading?.complete !== true ? 'INCOMPLETE' : statusOf(rows.map(row => row.status));
      const pooled = assessDrawBudget((reading?.rows ?? []).flatMap(row => row.drawSamples ?? []), rows.reduce((sum, row) => sum + row.frames, 0), { tier: software ? 'software-diagnostic' : tier, cpuRate });
      shards.push({ surface, shard, renderer: reading?.metadata?.renderer ?? null, viewport: reading?.metadata?.viewport ?? null, canvas: reading?.metadata?.canvas ?? null, bootCpuRate: phased ? reading?.cpuPhase?.bootRate ?? record.bootCpuRate ?? 1 : cpuRate,
        measuredCpuRate: phased ? reading?.cpuPhase?.measuredRate ?? null : cpuRate, poses: rows.length, samples: rows.reduce((sum, row) => sum + row.budget.samples, 0),
        frames: rows.reduce((sum, row) => sum + row.frames, 0), validDrawSamples: rows.reduce((sum, row) => sum + row.budget.validDrawSamples, 0),
        validCpuSamples: rows.reduce((sum, row) => sum + row.budget.validCpuSamples, 0), status,
        maxDraws: maximum(rows.map(row => row.budget.maxDraws)), maxRenderCpuUsPerDraw: maximum(rows.map(row => row.budget.maxRenderCpuUsPerDraw)),
        meanRenderCpuUsPerDraw: status === 'INCOMPLETE' ? null : pooled.meanRenderCpuUsPerDraw });
    }
  }
  return { schema: 1, officialTimingCredit: false, softwareDiagnostic: record.softwareCensus !== undefined, sha: record.sha ?? null, runId: record.runId ?? null, when: record.when ?? null,
    blocking: record.drawBudgetMode !== 'report-only', complete: record.complete === true && /^[a-f0-9]{40}$/u.test(record.sha ?? '')
      && (record.runId?.length ?? 0) > 0 && shards.length > 0 && shards.every(row => row.status !== 'INCOMPLETE'),
    drawLimit: PHONE_DRAW_LIMIT, cpuLimitUs: PHONE_DRAW_CPU_US, chromiumAngle: record.chromiumAngle ?? null,
    measurement: `${record.softwareCensus === undefined ? '' : 'Small-viewport spawn-only census; no phone-budget credit, all phone limits NOT MEASURED. '}${record.chromiumAngle === 'swiftshader' ? 'SwiftShader software-renderer diagnostic; CPU values describe this software-rendering stack. ' : ''}No official floor or physical-device timing credit. Whole completed frames, including shadow/post/held. Render CPU is paired with that same frame; <=30 us/draw requires actual Chromium phone 4x. Mean is total paired render CPU divided by total draws; max is the worst whole-frame ratio, not an individual draw. Max gates remain unchanged. No percentile ratios or clock extrapolation.`, shards, poses };
}

/** @param {string} value */
const cell = value => value.replaceAll('|', String.raw`\|`).replaceAll(/[\r\n]/gu, ' ');
/** @param {number|null|undefined} value */
const number = value => value === null || value === undefined ? 'n/a' : Number(value.toFixed(3)).toString();
/** @param {boolean|null} value */
const verdict = value => value === null ? 'NOT MEASURED' : value ? 'PASS' : 'MISS';
/** @param {string} shard
 * @param {string} pose
 * @param {number} frames
 * @param {import('../src/client/engine/core/drawBudget').DrawBudgetAssessment} budget
 * @param {string} renderer */
export function frameFloorDrawConsole(shard, pose, frames, budget, renderer) {
  return `Draw budget ${cell(shard)} / ${cell(pose)}: ${number(budget.maxDraws)} max draws; ${number(budget.maxRenderCpuUsPerDraw)} max us/draw; paired samples ${budget.validDrawSamples}/${frames} draws, ${budget.validCpuSamples}/${frames} CPU; ${number(budget.meanRenderCpuUsPerDraw)} mean us/draw; observed renderer ${cell(renderer)}; diagnostic only, no official timing credit`;
}
/** @param {import('./frame-floor-draw-report.mjs').FloorDrawReport} report */
export function frameFloorDrawMarkdown(report) {
  const lines = ['## Phone draw budget', '', `${report.blocking ? 'Enforced' : 'Report-only'}; source ${cell(report.sha ?? 'unbound')}; reading ${cell(report.runId ?? 'unbound')}.`,
    '', `Reading ${report.complete ? 'complete' : 'INCOMPLETE'}; Chromium renderer ${cell(report.chromiumAngle ?? 'unrecorded')}. Limits: <= ${report.drawLimit} draws; <= ${report.cpuLimitUs} us/render draw at measured Chromium phone 4x.`, '',
    '| Surface / shard | Observed renderer | CSS / canvas pixels | Boot / measured CPU | Poses | Draw samples | CPU samples | Max draws | Mean us/draw | Max frame us/draw | Budget |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |'];
  for (const row of report.shards) lines.push(`| ${cell(`${row.surface} / ${row.shard}`)} | ${cell(row.renderer ?? 'not observed')} | ${row.viewport?.join('x') ?? 'n/a'} / ${row.canvas?.join('x') ?? 'n/a'} | ${row.bootCpuRate}x / ${row.measuredCpuRate === null ? 'not applied' : `${row.measuredCpuRate}x`} | ${row.poses} | ${row.validDrawSamples}/${row.frames} | ${row.validCpuSamples}/${row.frames} | ${number(row.maxDraws)} | ${number(row.meanRenderCpuUsPerDraw)} | ${number(row.maxRenderCpuUsPerDraw)} | ${row.status} |`);
  lines.push('', '| Shard / pose | Clock | Samples | Max draws | Draws | Mean us/draw | Max frame us/draw | CPU | Budget |', '| --- | --- | ---: | ---: | --- | ---: | ---: | --- | --- |');
  for (const row of report.poses) lines.push(`| ${cell(`${row.shard} / ${row.pose}`)} | ${cell(row.surface)} ${cell(row.tier)} ${row.cpuRate}x | ${row.budget.samples}/${row.frames} | ${number(row.budget.maxDraws)} | ${verdict(row.budget.drawsPass)} | ${number(row.budget.meanRenderCpuUsPerDraw)} | ${number(row.budget.maxRenderCpuUsPerDraw)} | ${verdict(row.budget.cpuPass)} | ${row.status} |`);
  lines.push('', report.measurement, '');
  return lines.join('\n');
}

/** @param {import('./frame-floor-draw-report.mjs').FloorDrawRecord} record
 * @param {string} output Main floor JSON path; sibling report artifacts never replace it.
 * @param {string} [summary] CI's existing step-summary file, appended only when supplied. */
export function writeFrameFloorDrawReport(record, output, summary) {
  if (!output.endsWith('.json')) throw new Error('Draw report requires the main floor JSON path');
  const report = frameFloorDrawReport(record), text = frameFloorDrawMarkdown(report);
  const json = `${output.slice(0, -5)}-draw-budget.json`, markdown = `${output.slice(0, -5)}-draw-budget.md`;
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`); writeFileSync(markdown, text);
  if (summary !== undefined) appendFileSync(summary, text);
  return { json, markdown };
}
