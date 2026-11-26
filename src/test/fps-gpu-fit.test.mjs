import {expect, test} from 'vitest';
import {fitGpu, fitFencedGpu, fencedFromRouteBench, fencedFromMeasure} from '../scripts/fps/gpu-fit.mjs';
import {observeFencedGpu} from '../scripts/fps/gpuProbe.mjs';

const route = ['dock','beach','village','fire','road'].map(name => ({name,seconds:1}));
const training = ['dock','beach','village'], heldOut = ['fire','road'];
function pairs() {
  return [1,2,3].map(run => {
    const capture = phone => ({version:{build:'exact',rendererRevision:'same-renderer'},
      witness:{build:'exact',css:[390,664],dpr:1,phone:true,low:true,shadowsOff:true,gpu:'ANGLE Metal'},
      legs:route.map(({name}, index) => ({name,cap:30,samples:[{seconds:1,frames:30,frameMs:Array.from({length:30}, () => 33 + run / 100)}],
        summary:{gpuApproxP95Ms:2 * (index + run)}, metal:phone ? null : {frames:4,p95Ms:index + run}}))});
    return {phone:capture(true),mac:capture(false)};
  });
}

test('records a three-run ratio and its segment spread, validating two untouched segments', () => {
  const report = fitGpu(pairs(),route,training,heldOut);
  expect(report).toMatchObject({qualified:true,ratio:2,byRun:[2,2,2],spread:{min:2,max:2}});
  expect(report.validation).toHaveLength(2);
  expect(report.validation.flatMap(leg => leg.runs).every(run => run.pass)).toBe(true);
});

test('held-out observations cannot improve the fit, and one bad run prevents qualification', () => {
  const inputs = pairs();
  inputs[2].phone.legs[4].summary.gpuApproxP95Ms = 30;
  const report = fitGpu(inputs,route,training,heldOut);
  expect(report.ratio).toBe(2);
  expect(report.qualified).toBe(false);
  expect(report.validation[1].runs[2].pass).toBe(false);
  expect(() => fitGpu(inputs,route,[...training,'road'],heldOut)).toThrow('disjoint');
});

test('refuses duplicated, interrupted, mixed-build and mismatched graphics captures', () => {
  const duplicate = pairs(); duplicate[2] = duplicate[1];
  expect(() => fitGpu(duplicate,route,training,heldOut)).toThrow('independent');
  for (const mutate of [
    inputs => { inputs[0].mac.witness.build = 'different'; },
    inputs => { inputs[0].phone.witness.low = false; },
    inputs => { inputs[0].mac.witness.css = [402,812]; },
    inputs => { inputs[0].phone.version.rendererRevision = ''; },
    inputs => { inputs[0].phone.legs[1].cap = 60; },
    inputs => { inputs[0].mac.witness.gpu = 'SwiftShader'; },
    inputs => { inputs[0].mac.legs[3].samples = []; },
    inputs => { inputs[0].phone.legs[4].error = 'stuck'; },
    inputs => { inputs[0].mac.legs[1].metal.frames = 0; },
  ]) {
    const inputs = pairs(); mutate(inputs);
    expect(() => fitGpu(inputs,route,training,heldOut)).toThrow();
  }
});

test('changing a derived summary cannot turn the same raw capture into a repeat', () => {
  const inputs = pairs();
  inputs[2].phone = structuredClone(inputs[1].phone);
  inputs[2].phone.legs[0].summary.gpuApproxP95Ms = 99;
  expect(() => fitGpu(inputs,route,training,heldOut)).toThrow('independent');
});

test('a cadence term can explain the fire residual without qualifying an unobserved GPU cost', () => {
  const inputs = pairs();
  for (const [run,pair] of inputs.entries()) {
    for (const [index,leg] of pair.phone.legs.entries()) {
      leg.samples = [{seconds:1,frames:30,frameMs:Array.from({length:30},(_,frame) =>
        frame === 0 ? 32-run : frame === 1 ? 32+index : frame % 3 === 0 ? 34 : 33)}];
      leg.samples[0].gpuApproxMs = leg.samples[0].frameMs.map(ms => Math.max(0,ms-1000/30));
      leg.summary.gpuApproxP95Ms = 0.7;
      pair.mac.legs[index].metal.p95Ms = index === 3 ? 6.57 : 8.83;
    }
  }
  const report = fitGpu(inputs,route,training,heldOut);
  expect(report.validation[0].runs.every(run => !run.pass)).toBe(true);
  expect(report.observation).toMatchObject({floorMs:34-1000/30,gpuRatioIdentifiable:false});
  expect(report.observation.validation.flatMap(leg => leg.runs).every(run => run.pass)).toBe(true);
  expect(report.qualified).toBe(false);
  const baseline = structuredClone(report.observation.training);
  inputs[2].phone.legs[3].summary.gpuApproxP95Ms = 9;
  const changed = fitGpu(inputs,route,training,heldOut);
  expect(changed.observation.training).toEqual(baseline);
  expect(changed.observation.validation[0].runs[2].pass).toBe(false);
  for (const pair of inputs) for (const leg of pair.phone.legs) leg.samples[0].gpuApproxMs.fill(0);
  expect(fitGpu(inputs,route,training,heldOut).observation).toBeNull();
});

// DF5 (mini-dwfps, 2026-11-23): the fenced fit reads gpuProbe.mjs's fenced frames from both benches
test('the fenced fit trains on training legs only and qualifies when every held-out run is within 25%', () => {
  const names = ['dock','beach','village','fire','road'];
  const fenced = (run, macMs, scale, gpu) => ({ build: 'exact', css: [390, 664], dpr: 1, gpu,
    legs: names.map((name, i) => ({ name, frames: 40, ms: macMs[i] * scale + run / 100 })) });
  const mac = [2, 3, 4, 2.5, 3.5];
  const inputs = [1, 2, 3].map(run => ({ phone: fenced(run, mac, 6, null), mac: fenced(0, mac, 1, 'ANGLE Metal Renderer: Apple M5 Pro') }));
  const report = fitFencedGpu(inputs, ['dock','beach','village'], ['fire','road']);
  expect(report.qualified).toBe(true);
  expect(report.ratio).toBeGreaterThan(6);
  expect(report.ratio).toBeLessThan(6.01);
  inputs[1].phone.legs[4].ms = 40;
  expect(fitFencedGpu(inputs, ['dock','beach','village'], ['fire','road']).qualified).toBe(false);
  expect(fitFencedGpu(inputs, ['dock','beach','village'], ['fire','road']).ratio).toBe(report.ratio);
  inputs[2].phone.legs[3].error = 'incomplete waypoint, dwell or road return';
  expect(() => fitFencedGpu(inputs, ['dock','beach','village'], ['fire','road'])).toThrow('complete route');
  inputs[2].phone.legs[3].error = null;
  inputs[0].mac.gpu = 'SwiftShader';
  expect(() => fitFencedGpu(inputs, ['dock','beach','village'], ['fire','road'])).toThrow('Metal');
});

test('route-bench and measureFps captures normalize to the same fenced shape', () => {
  const phone = fencedFromRouteBench({ boot: { build: 'b' }, raster: { css: [390, 664], dpr: 1 }, legs: [{ name: 'dock', probe: { frames: 30, tailMeanMs: 9 } }] });
  const mac = fencedFromMeasure({ witness: { build: 'b', css: [390, 664], dpr: 1, gpu: 'Metal' }, legs: [{ name: 'dock', fencedGpu: { frames: 31, tailMeanMs: 1.5 } }] });
  expect(phone.legs[0]).toEqual({ name: 'dock', frames: 30, ms: 9, error: null });
  expect(mac.legs[0]).toEqual({ name: 'dock', frames: 31, ms: 1.5, error: null });
});

test('the probe fences one frame in n with a readPixels before and after it, then restores the draw', () => {
  const reads = [];
  const gl = { IMPLEMENTATION_COLOR_READ_TYPE: 1, IMPLEMENTATION_COLOR_READ_FORMAT: 2, UNSIGNED_BYTE: 5121, NO_ERROR: 0, FLOAT: 5126, HALF_FLOAT: 5131, UNSIGNED_INT: 5125, INT: 5124,
    getParameter: (key) => key === 1 ? 5121 : 6408, readPixels: (...args) => { reads.push(args[6].constructor.name); }, getError: () => 0 };
  class Ranges { draw() { return 'drawn'; } }
  const game = { frameDrawRanges: new Ranges(), renderer: { getContext: () => gl } };
  const stop = observeFencedGpu(game, 3);
  for (let i = 0; i < 9; i++) expect(game.frameDrawRanges.draw()).toBe('drawn');
  const summary = stop();
  expect(reads).toEqual(Array(6).fill('Uint8Array'));
  expect(summary).toMatchObject({ every: 3, frames: 3, refused: 0 });
  expect(Object.hasOwn(game.frameDrawRanges, 'draw')).toBe(false);
});
