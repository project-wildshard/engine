import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise report artifact publication in the owned test scratch root.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the test's owned scratch filenames.
import { join } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The maintained Vitest scratch adapter owns this root.
import { tmpdir } from 'node:os';
import { frameFloorDrawReport, frameFloorDrawMarkdown, frameFloorDrawConsole, writeFrameFloorDrawReport, type FloorDrawRecord } from '../scripts/frame-floor-draw-report.mjs';

const slugs = ['nine-dragon-stack', 'pine-hollow', 'driftwood-isle'];
function phasedRecord(): FloorDrawRecord {
  return {sha: 'b'.repeat(40), runId: 'post-ready', complete: true, drawBudgetMode: 'report-only', cpuPhaseMode: 'after-ready', bootCpuRate: 1,
    surface: 'desktop', chromiumCpuRate: 4, settings: {tier: 'phone'}, shards: ['nine-dragon-stack'],
    results: [{surface: 'desktop', rows: [{shard: 'nine-dragon-stack', complete: true,
      cpuPhase: {bootRate: 1, requestedRate: 4, measuredRate: 4, fence: {frame: 10, atMs: 100, firstCompletedFrame: 12, documentOrigin: 1000}},
      rows: [{frames: 2, sampleRange: {startMs: 110, endMs: 150}, drawSamples: [{drawnFrame: 13, draws: 150, renderMs: 4.5}, {drawnFrame: 14, draws: 100, renderMs: 3}]}]}]}]};
}
function record(): FloorDrawRecord {
  return { sha: 'a'.repeat(40), runId: 'draw-reading-1', when: '2026-10-30T21:00:00Z', complete: true, drawBudgetMode: 'report-only',
    surface: 'desktop', chromiumCpuRate: 4, settings: { tier: 'phone' }, shards: slugs,
    results: [{ surface: 'desktop', rows: slugs.map((shard, index) => ({ shard, complete: true, metadata: { settings: { tier: 'phone' } },
      rows: [{ pose: { name: 'spawn' }, frames: 2, drawSamples: [{ draws: 150 + index, renderMs: 4.5 }, { draws: 100, renderMs: 3.01 }] },
        { pose: { name: 'standing' }, frames: 1, drawSamples: [{ draws: 120, renderMs: 3.6 }] }] })) }] };
}

test('all three shard/pose rows retain paired worst frames and source-bound report-only misses', () => {
  const input = record(), before = structuredClone(input), report = frameFloorDrawReport(input);
  expect(report).toMatchObject({ schema: 1, sha: 'a'.repeat(40), runId: 'draw-reading-1', blocking: false, complete: true, drawLimit: 150, cpuLimitUs: 30 });
  expect(report.shards.map(row => [row.shard, row.poses, row.validDrawSamples, row.frames, row.status])).toEqual(slugs.map(shard => [shard, 2, 3, 3, 'MISS']));
  expect(report.shards.map(row => row.maxDraws)).toEqual([150, 151, 152]);
  // No pooled ratio: the one 100-draw frame is 30.1 us, even though the combined ratio passes.
  expect(report.shards[0]?.maxRenderCpuUsPerDraw).toBeCloseTo(30.1);
  expect(report.poses).toHaveLength(6); expect(report.poses[1]?.status).toBe('PASS');
  const markdown = frameFloorDrawMarkdown(report);
  for (const slug of slugs) expect(markdown).toContain(slug);
  expect(markdown).toContain('Report-only'); expect(markdown).toContain('30.1'); expect(markdown).toContain('MISS');
  expect(input).toEqual(before);
});

test('missing shard, sample, render CPU and duplicate readings cannot claim complete coverage', () => {
  for (const kind of ['shard', 'sample', 'cpu', 'zero', 'duplicate']) {
    const input = record(), surface = input.results[0], reading = surface?.rows[0];
    if (surface === undefined || reading === undefined) throw new Error('Missing report fixture');
    const rows = [...surface.rows];
    if (kind === 'shard') rows.pop();
    if (kind === 'duplicate') rows.push(reading);
    if (kind === 'sample') rows[0] = { ...reading, rows: [{ frames: 2, drawSamples: [{ draws: 100, renderMs: 1 }] }] };
    if (kind === 'cpu') rows[0] = { ...reading, rows: [{ frames: 1, drawSamples: [{ draws: 100, renderMs: Number.NaN }] }] };
    if (kind === 'zero') rows[0] = { ...reading, rows: [{ frames: 1, drawSamples: [{ draws: 0, renderMs: 0 }] }] };
    input.results = [{ ...surface, rows }];
    const report = frameFloorDrawReport(input);
    expect(report.complete, kind).toBe(false);
    expect(report.shards.some(row => row.status === 'INCOMPLETE'), kind).toBe(true);
  }
});

test('1x and Simulator retain actual cost but never earn a 4x CPU pass or extrapolation', () => {
  for (const surface of ['desktop', 'sim']) {
    const input = record(), original = input.results[0]; if (original === undefined) throw new Error('Missing surface');
    input.surface = surface; input.chromiumCpuRate = surface === 'sim' ? 4 : 1;
    input.results = [{ ...original, surface, rows: [{ shard: slugs[0] ?? '', complete: true, rows: [{ frames: 1, drawSamples: [{ draws: 150, renderMs: 4.5 }] }] }] }];
    input.shards = [slugs[0] ?? ''];
    const report = frameFloorDrawReport(input);
    expect(report.poses[0]).toMatchObject({ cpuRate: 1, status: 'NOT MEASURED', budget: { maxRenderCpuUsPerDraw: 30, cpuApplied: false, cpuPass: null } });
  }
});

test('writes sibling JSON/Markdown and appends CI summary without overwriting the raw floor record', () => {
  const root = mkdtempSync(join(tmpdir(), 'frame-draw-report-'));
  try {
    const output = join(root, 'floor.json'), summary = join(root, 'summary.md');
    writeFileSync(output, 'raw floor record'); writeFileSync(summary, 'prior CI summary\n');
    const paths = writeFrameFloorDrawReport(record(), output, summary);
    expect(readFileSync(output, 'utf8')).toBe('raw floor record');
    expect(paths).toEqual({ json: join(root, 'floor-draw-budget.json'), markdown: join(root, 'floor-draw-budget.md') });
    expect(JSON.parse(readFileSync(paths.json, 'utf8'))).toMatchObject({ blocking: false, complete: true, sha: 'a'.repeat(40) });
    expect(readFileSync(summary, 'utf8')).toBe(`prior CI summary\n${readFileSync(paths.markdown, 'utf8')}`);
    expect(() => writeFrameFloorDrawReport(record(), join(root, 'unsafe'))).toThrow('main floor JSON');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('post-ready CPU credit requires every paired frame after the acknowledged throttle fence', () => {
  expect(frameFloorDrawReport(phasedRecord())).toMatchObject({complete: true, poses: [{status: 'PASS', cpuRate: 4}]});
  for (const invalid of ['phase', 'rate', 'time', 'frame', 'identity', 'fence', 'boot', 'new-draws']) {
    const input = phasedRecord(), reading = input.results[0]?.rows[0], row = reading?.rows?.[0], phase = reading?.cpuPhase;
    const fence = phase?.fence, sample = row?.drawSamples?.[0];
    if (reading === undefined || row === undefined || phase === null || phase === undefined || fence === null || fence === undefined || sample === undefined || row.sampleRange === undefined)
      throw new Error('Missing post-ready fixture');
    if (invalid === 'phase') reading.cpuPhase = null;
    if (invalid === 'rate') phase.measuredRate = null;
    if (invalid === 'time') row.sampleRange.startMs = 99;
    if (invalid === 'frame') sample.drawnFrame = 12;
    if (invalid === 'identity') delete sample.drawnFrame;
    if (invalid === 'fence') phase.fence = null;
    if (invalid === 'boot') phase.bootRate = 4;
    if (invalid === 'new-draws') fence.firstCompletedFrame = 10;
    const report = frameFloorDrawReport(input);
    expect(report.complete, invalid).toBe(false); expect(report.poses[0]?.status, invalid).toBe('INCOMPLETE');
  }
});

test('three-world software reports print actual paired numbers and never claim official timing credit', () => {
  const input = phasedRecord(), reading = input.results[0]?.rows[0];
  if (reading === undefined) throw new Error('Missing post-ready fixture');
  const renderer = 'ANGLE (Google, Vulkan 1.3 (SwiftShader Device), SwiftShader driver)';
  input.chromiumAngle = 'swiftshader'; input.shards = slugs;
  input.results = [{surface: 'desktop', rows: slugs.map(shard => ({...reading, shard, metadata: {renderer, settings: {tier: 'phone'}}}))}];
  const report = frameFloorDrawReport(input), markdown = frameFloorDrawMarkdown(report);
  expect(report).toMatchObject({complete: true, blocking: false, officialTimingCredit: false});
  expect(report.shards.map(row => [row.shard, row.renderer, row.maxDraws, row.maxRenderCpuUsPerDraw])).toEqual(slugs.map(shard => [shard, renderer, 150, 30]));
  expect(markdown).toContain('SwiftShader software-renderer diagnostic');
  expect(markdown).toContain('No official floor or physical-device timing credit');
  for (const pose of report.poses) {
    const line = frameFloorDrawConsole(pose.shard, pose.pose, pose.frames, pose.budget, renderer);
    expect(line).toContain(pose.shard); expect(line).toContain('150 max draws; 30 max us/draw');
    expect(line).toContain('paired samples 2/2 draws, 2/2 CPU');
    expect(line).toContain(renderer); expect(line).toContain('no official timing credit');
  }
  const absent = frameFloorDrawReport({...input, results: [{surface: 'desktop', rows: [{...reading, rows: [{frames: 2}]}]}]}).poses[0];
  if (absent === undefined) throw new Error('Missing incomplete row');
  expect(frameFloorDrawConsole(absent.shard, absent.pose, absent.frames, absent.budget, renderer)).toContain('n/a max draws; n/a max us/draw; paired samples 0/2 draws, 0/2 CPU');
});


test('shard mean pools raw paired draws across poses instead of averaging pose means', () => {
  const input = record(), first = input.results[0]?.rows[0];
  if (first === undefined) throw new Error('Missing fixture shard');
  first.rows = [{ pose: { name: 'one' }, frames: 1, drawSamples: [{ draws: 100, renderMs: 1 }] },
    { pose: { name: 'two' }, frames: 2, drawSamples: [{ draws: 10, renderMs: .3 }, { draws: 20, renderMs: .1 }] }];
  const report = frameFloorDrawReport(input);
  expect(report.shards[0]?.meanRenderCpuUsPerDraw).toBeCloseTo(1400 / 130);
  expect(report.poses[1]?.budget.meanRenderCpuUsPerDraw).toBeCloseTo(400 / 30);
  expect(report.shards[0]?.maxRenderCpuUsPerDraw).toBe(30);
  expect(frameFloorDrawMarkdown(report)).toContain('Mean us/draw');
  const reading = input.results[0];
  if (reading === undefined) throw new Error('Missing fixture reading');
  reading.rows = [...reading.rows, first];
  expect(frameFloorDrawReport(input).shards[0]).toMatchObject({ status: 'INCOMPLETE', meanRenderCpuUsPerDraw: null });
});
