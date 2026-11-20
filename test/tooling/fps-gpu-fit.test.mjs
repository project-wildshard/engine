import {expect, test} from 'vitest';
import {fitGpu} from '../../scripts/fps/gpu-fit.mjs';

const route = ['dock','beach','village','fire','road'].map(name => ({name,seconds:1}));
const training = ['dock','beach','village'], heldOut = ['fire','road'];
function pairs() {
  return [1,2,3].map(run => {
    const capture = phone => ({version:{build:'exact',rendererRevision:'same-renderer'},
      witness:{build:'exact',css:[390,664],dpr:1,phone:true,low:true,shadowsOff:true},
      legs:route.map(({name}, index) => ({name, samples:[{seconds:1,frames:30,frameMs:Array.from({length:30}, () => 33 + run / 100)}],
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
    inputs => { inputs[0].mac.legs[3].samples = []; },
    inputs => { inputs[0].phone.legs[4].error = 'stuck'; },
    inputs => { inputs[0].mac.legs[1].metal.frames = 0; },
  ]) {
    const inputs = pairs(); mutate(inputs);
    expect(() => fitGpu(inputs,route,training,heldOut)).toThrow();
  }
});
