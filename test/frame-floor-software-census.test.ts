import {expect, test} from 'vitest';
import {frameFloorSoftwareCensus} from '../scripts/frame-floor-args.mjs';
import {frameFloorDrawReport, frameFloorDrawMarkdown, frameFloorDrawConsole, type FloorDrawRecord} from '../scripts/frame-floor-draw-report.mjs';
import {assertFrameFloorRenderer} from '../scripts/frame-floor-report-phase.mjs';
import {assessDrawBudget} from '../src/client/engine/core/drawBudget';
import {gridFloorRuntimeFailure} from '../scripts/frame-floor-grid.mjs';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the maintained controller without a browser/build.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolate the real software branch and its explicit test-owned loans.
import {runInNewContext} from 'node:vm';

const args = ['--surface=desktop', '--chromium-phone', '--chromium-cpu=4', '--chromium-angle=swiftshader', '--draw-budget-report-only', '--software-draw-census', '--frames=4'];
const renderer = 'ANGLE (Google, Vulkan 1.3 (SwiftShader Device), SwiftShader driver)';

test('small software census is explicit and cannot change official/full phone commands', () => {
  expect(frameFloorSoftwareCensus(args, 'linux')).toEqual({viewport: {width: 201, height: 437}, frames: 4, scope: 'spawn-only'});
  expect(frameFloorSoftwareCensus([], 'linux')).toBeNull();
  expect(frameFloorSoftwareCensus(['--draw-budget', '--surface=desktop', '--chromium-phone', '--chromium-cpu=4', '--frames=120'], 'darwin')).toBeNull();
  expect(() => frameFloorSoftwareCensus(args, 'darwin')).toThrow();
  for (const removed of ['--chromium-angle=swiftshader', '--draw-budget-report-only', '--surface=desktop', '--chromium-phone', '--chromium-cpu=4', '--frames=4'])
    expect(() => frameFloorSoftwareCensus(args.filter(arg => arg !== removed), 'linux'), removed).toThrow();
  for (const added of ['--draw-budget', '--frames=120', '--standing-poses=P1', '--shards=grid', '--grid-scenario=cell'])
    expect(() => frameFloorSoftwareCensus([...args, added], 'linux'), added).toThrow();
});

function reading(): FloorDrawRecord {
  return {sha: 'c'.repeat(40), runId: 'software', complete: true, drawBudgetMode: 'report-only', chromiumAngle: 'swiftshader', chromiumAngleExplicit: true, chromiumCpuRate: 4,
    cpuPhaseMode: 'after-ready', bootCpuRate: 1, surface: 'desktop', shards: ['nine-dragon-stack', 'pine-hollow', 'driftwood-isle'],
    softwareCensus: {viewport: {width: 201, height: 437}, frames: 4, scope: 'spawn-only'},
    results: [{surface: 'desktop', rows: ['nine-dragon-stack', 'pine-hollow', 'driftwood-isle'].map(shard => ({shard, complete: true,
      metadata: {renderer, viewport: [201,437], canvas: [402,874], renderScale: 2, settings: {tier: 'phone'}},
      cpuPhase: {bootRate: 1, requestedRate: 4, measuredRate: 4, fence: {frame: 10, firstCompletedFrame: 12, atMs: 100, documentOrigin: 1000}},
      rows: [{pose: {name: 'spawn'}, frames: 4, sampleRange: {startMs: 110, endMs: 150},
        drawSamples: [13,14,15,16].map(drawnFrame => ({drawnFrame, draws: 999, renderMs: 999}))}]}))}]};
}

test('software counts retain actual resolution and paired cost but no phone budget or official credit', () => {
  const report = frameFloorDrawReport(reading());
  expect(report).toMatchObject({complete: true, blocking: false, officialTimingCredit: false, softwareDiagnostic: true});
  for (const row of report.shards) expect(row).toMatchObject({renderer, viewport: [201,437], canvas: [402,874], frames: 4, validDrawSamples: 4, validCpuSamples: 4,
    maxDraws: 999, maxRenderCpuUsPerDraw: 1000, status: 'NOT MEASURED'});
  for (const row of report.poses) expect(row.budget).toMatchObject({applied: false, cpuApplied: false, drawsPass: null, cpuPass: null});
  const text = frameFloorDrawMarkdown(report);
  expect(text).toContain('201x437 / 402x874'); expect(text).toContain('spawn-only');
  expect(text).toContain('no phone-budget credit'); expect(text).toContain('No official floor');
});

test('wrong backend/resolution, missing pairs, foreign pose and pre-throttle frames cannot claim a complete census', () => {
  for (const kind of ['backend','viewport','canvas','scale','pose','count','cpu','fence','enforce','unphased','all-phase-evidence','implicit','non4','no-fence']) {
    const record = reading(), world = record.results[0]?.rows[0], row = world?.rows?.[0];
    if (world?.metadata === undefined || row === undefined) throw new Error('Missing software fixture');
    if (kind === 'backend') world.metadata.renderer = 'ANGLE Metal Renderer: Apple';
    if (kind === 'viewport') world.metadata.viewport = [402,874];
    if (kind === 'canvas') world.metadata.canvas = [804,1748];
    if (kind === 'scale') world.metadata.renderScale = 1;
    if (kind === 'pose') row.pose = {name:'P1'};
    if (kind === 'count') row.frames = 120;
    if (kind === 'cpu') row.drawSamples = [{drawnFrame: 13, draws: 999, renderMs: Number.NaN}];
    if (kind === 'fence') row.drawSamples = [11,12,13,14].map(drawnFrame => ({drawnFrame, draws: 999, renderMs: 999}));
    if (kind === 'enforce') record.drawBudgetMode = 'enforce';
    if (kind === 'unphased') delete record.cpuPhaseMode;
    if (kind === 'implicit') delete record.chromiumAngleExplicit;
    if (kind === 'all-phase-evidence') {
      delete record.cpuPhaseMode; delete world.cpuPhase; delete row.sampleRange;
    }
    if (kind === 'no-fence' && world.cpuPhase !== undefined && world.cpuPhase !== null) world.cpuPhase.fence = null;
    if (kind === 'non4') {
      record.chromiumCpuRate = 3;
      for (const target of record.results[0]?.rows ?? []) if (target.cpuPhase !== undefined && target.cpuPhase !== null) {
        target.cpuPhase.requestedRate = 3; target.cpuPhase.measuredRate = 3;
      }
    }
    expect(frameFloorDrawReport(record).complete, kind).toBe(false);
  }
});

async function softwareController(failure?: 'ready' | 'sample' | 'unload') {
  const source = readFileSync('scripts/frame-floor.mjs', 'utf8');
  const start = source.indexOf('async function measureShard('), end = source.indexOf('\n/** Long tasks inside', start);
  if (start === -1 || end === -1) throw new Error('Missing maintained shard controller');
  const events: string[] = [];
  const driver = {
    load: (shard: string) => {events.push(`load:${shard}`); return Promise.resolve();},
    beginMeasurement: () => {events.push('throttle-and-fence'); return Promise.resolve();},
    evaluate: (code: string): Promise<unknown> => Promise.resolve().then(() => {
      const value: unknown = runInNewContext(code);
      return value;
    }),
    errors: () => Promise.resolve([]), progress: () => null, cpuPhase: () => null,
    unload: () => {events.push('unload'); return failure === 'unload' ? Promise.reject(new Error('Fixture cleanup refusal')) : Promise.resolve();},
  };
  let result: unknown, error: unknown;
  try { result = await runInNewContext(`(${source.slice(start,end)})(driver,'nine-dragon-stack',Date.now()+600000)`, {
    driver, surface: 'desktop', softwareCensus: frameFloorSoftwareCensus(args,'linux'), frames: 4, settleMs: 2000,
    chromiumPhone: args.includes('--chromium-phone'), desktopDpr: 2,
    developer: 'on', settings: {tier:'phone'}, picks: {}, deviceSaves: {}, expectedSystems: [], publicGrid: false,
    process: {platform: 'linux'}, chromiumBackend: {angle: 'swiftshader', explicit: true}, drawBudgetOn: true, drawBudgetMode: 'report-only',
    evaluationOriginDriftMaxMs: 0, assertFrameFloorRenderer, frameFloorDrawConsole, gridFloorRuntimeFailure,
    errorText: (value: unknown) => value instanceof Error ? value.message : String(value),
    console: {log: () => undefined, error: () => undefined},
    waitReady: () => {events.push('ready'); return failure === 'ready' ? Promise.reject(new Error('Fixture readiness deadline')) : Promise.resolve();}, sleep: () => Promise.resolve(),
    gridFloorDocumentIdentity: function gridFloorDocumentIdentity() {return {token:'document',timeOrigin:1000};},
    metadata: function metadata() {return {renderer: 'ANGLE (Google, Vulkan 1.3 (SwiftShader Device), SwiftShader driver)',
      viewport:[201,437],canvas:[402,874],renderScale:2,settings:{tier:'phone',fps:'auto'},developer:true,deviceSaves:{devMode:true},clock:'live',
      spawn:{name:'spawn',x:1,y:2,z:3},systems:[]};},
    standingSample: (_driver: unknown, pose: {name:string}) => {
      events.push(`sample:${pose.name}`);
      if (failure === 'sample') return Promise.reject(new Error('Fixture sampler refusal'));
      return Promise.resolve({pose,frames:4,pass:false,medianFps:1,p95Ms:1000,p99Ms:1000,
        drawBudget:assessDrawBudget(Array.from({length:4},()=>({draws:200,renderMs:20})),4,{tier:'software-diagnostic',cpuRate:4})});
    },
  }); } catch (caught) { error = caught; }
  return {result,error,events};
}

test('the real software controller samples only the ready native spawn and always unloads', async () => {
  const {result,error,events} = await softwareController();
  expect(error).toBeUndefined();
  expect(result).toMatchObject({complete:true,pass:false,cameraSource:'software diagnostic native spawn only',scan:[],rows:[{frames:4}]});
  expect(events).toEqual(['load:nine-dragon-stack','ready','throttle-and-fence','sample:spawn','unload']);
});

test('readiness and sampler refusals keep their errors and always unload without later samples', async () => {
  for (const stage of ['ready', 'sample'] as const) {
    const {result,error,events} = await softwareController(stage);
    expect(error).toBeUndefined();
    expect(result).toMatchObject({complete:false,pass:false,error: stage === 'ready' ? 'Fixture readiness deadline' : 'Fixture sampler refusal'});
    expect(events).toEqual(stage === 'ready' ? ['load:nine-dragon-stack','ready','unload']
      : ['load:nine-dragon-stack','ready','throttle-and-fence','sample:spawn','unload']);
  }
});

test('cleanup refusal cannot turn a software census into a completed result', async () => {
  const {result,error,events} = await softwareController('unload');
  expect(result).toBeUndefined();
  expect(error).toMatchObject({message:'Fixture cleanup refusal'});
  expect(events.at(-1)).toBe('unload');
});
