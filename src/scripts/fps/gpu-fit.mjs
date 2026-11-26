#!/usr/bin/env node
// DF5: fit only the declared training segments, then test untouched segments. --fenced fits gpuProbe.mjs's fenced frames.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { signature } from './matrix.mjs';
import { fpsVerdict } from './verdict.mjs';

/** @typedef {{name:string,seconds:number}} Segment */
/** @typedef {{build:string,css:number[],dpr:number,phone:boolean,low:boolean,shadowsOff:boolean,gpu?:string}} Witness */
/** @typedef {{seconds:number,frames:number,frameMs:number[],gpuApproxMs?:number[]}} FrameSample */
/** @typedef {{version:{build:string,rendererRevision:string},witness:Witness,
 * legs:(Omit<Parameters<typeof fpsVerdict>[0][number],'samples'> & {samples?:FrameSample[],cap:number|null,summary?:{gpuApproxP95Ms:number},
 * metal?:{frames:number,p95Ms:number|null}})[]}} Capture */
/** @typedef {{phone:Capture,mac:Capture}} Pair */

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b), at = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[at] : (sorted[at - 1] + sorted[at]) / 2;
}

/** Diagnose the observation floor separately from rendering cost. The phone's
 * gpu~ is max(0, frame interval - max(CPU, cap interval)), not a GPU timer.
 * An integer-ms clock at 30 fps produces 34 - 1000/30 ms with idle GPU time.
 * Train this term without looking at either held-out segment. It can explain
 * a residual, but cannot identify a GPU speed ratio below the cap.
 * @param {Pair[]} pairs @param {string[]} training @param {number} ratio
 * @param {{name:string,runs:{run:number,measuredMs:number,predictedMs:number,errorFraction:number|null,pass:boolean}[]}[]} validation */
function cadenceObservation(pairs, training, ratio, validation) {
  const rows = pairs.flatMap(({phone}, run) => phone.legs.filter(leg => training.includes(leg.name)).map(leg => {
    const frames = (leg.samples ?? []).flatMap(sample => sample.frameMs);
    const residuals = (leg.samples ?? []).flatMap(sample => sample.gpuApproxMs ?? []);
    const capMs = 1000 / /** @type {number} */ (leg.cap);
    const floorMs = Math.ceil(capMs) - capMs;
    // Use the retained residual, which already subtracts CPU time when it
    // exceeds the cap. Reconstructing from frame intervals would count CPU.
    const sorted = residuals.sort((a,b) => a-b);
    const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)];
    return {run:run + 1,name:leg.name,frames:frames.length,floorMs,
      integerClock:frames.length > 0 && frames.every(Number.isInteger) && residuals.length === frames.length &&
        residuals.every(ms => Number.isFinite(ms) && ms >= 0),p95};
  }));
  if (!rows.every(row => row.integerClock) ||
      rows.filter(row => Math.abs(row.p95 - row.floorMs) < 1e-9).length <= rows.length / 2) return null;
  const floorMs = median(rows.map(row => row.floorMs));
  return {kind:'capped-frame-residual',floorMs,training:rows,
    gpuRatioIdentifiable:false,
    reason:'Most training observations equal the integer-clock cadence floor; sub-cap GPU cost is unobserved.',
    validation:validation.map(leg => ({name:leg.name,runs:leg.runs.map(row => {
      const predictedMs = Math.max(floorMs,row.predictedMs);
      const errorMs = Math.abs(predictedMs-row.measuredMs);
      return {...row,predictedMs,errorFraction:row.measuredMs === 0 ? null : errorMs/row.measuredMs,
        pass:errorMs <= row.measuredMs*0.25};
    })})),ratio};
}

/** The hold-outs never contribute to the fitted ratio. Every run must pass.
 * @param {Pair[]} pairs @param {Segment[]} route @param {string[]} training @param {string[]} heldOut */
export function fitGpu(pairs, route, training, heldOut) {
  if (pairs.length < 3) throw new Error('DF5 needs at least three independent matched route pairs');
  const names = route.map(leg => leg.name), assigned = [...training, ...heldOut];
  if (training.length === 0 || heldOut.length < 2 || new Set(assigned).size !== assigned.length ||
      assigned.some(name => !names.includes(name))) throw new Error('Declare disjoint training and at least two held-out segments');
  const first = pairs[0].phone;
  if (!first.version.build || !first.version.rendererRevision || first.witness.css.length !== 2 ||
      first.witness.css.some(size => !Number.isFinite(size) || size <= 0) || first.witness.dpr !== 1)
    throw new Error('Missing exact-build or raster witness for phone Low');
  for (const side of ['phone', 'mac']) {
    const captures = pairs.map(pair => pair[/** @type {'phone'|'mac'} */ (side)]);
    if (new Set(captures.map(capture => signature(capture.legs.map(({name,samples}) => ({name,samples}))))).size !== captures.length)
      throw new Error(`Duplicate ${side} capture is not an independent repeat`);
    for (const capture of captures) {
      const { witness, version } = capture;
      if (version.build !== first.version.build || witness.build !== version.build ||
          version.rendererRevision !== first.version.rendererRevision ||
          JSON.stringify(witness.css) !== JSON.stringify(first.witness.css) || witness.dpr !== first.witness.dpr ||
          !witness.phone || !witness.low || !witness.shadowsOff)
        throw new Error('Matched captures need the same build, renderer, raster and phone Low workload');
      if (fpsVerdict(capture.legs, route, 30).verdict === 'incomplete')
        throw new Error('A complete route, including navigation and every frame, is required');
      if (capture.legs.some(leg => leg.cap !== 30)) throw new Error('GPU fit routes must use the same 30 fps cap');
      if (side === 'mac' && (!/metal/iu.test(witness.gpu ?? '') || /software|swiftshader/iu.test(witness.gpu ?? '')))
        throw new Error('GPU fit requires hardware Metal measurements');
    }
  }
  const segments = names.map(name => {
    const measurements = pairs.map(({phone, mac}, run) => {
      const phoneLeg = phone.legs.find(leg => leg.name === name), macLeg = mac.legs.find(leg => leg.name === name);
      const phoneMs = phoneLeg?.summary?.gpuApproxP95Ms, macMs = macLeg?.metal?.p95Ms;
      if (typeof phoneMs !== 'number' || !Number.isFinite(phoneMs) || phoneMs < 0 ||
          typeof macMs !== 'number' || !Number.isFinite(macMs) || macMs <= 0 || !(macLeg?.metal?.frames))
        throw new Error(`Missing phone gpu~ or Metal timer queries for ${name}`);
      return {run:run + 1, phoneMs, macMs, ratio:phoneMs / macMs};
    });
    const ratios = measurements.map(row => row.ratio);
    return {name, role:training.includes(name) ? 'training' : heldOut.includes(name) ? 'held-out' : 'unused',
      ratio:median(ratios), spread:{min:Math.min(...ratios), max:Math.max(...ratios)}, measurements};
  });
  const byRun = pairs.map((_, run) => median(segments.filter(leg => training.includes(leg.name))
    .map(leg => leg.measurements[run].ratio)));
  const ratio = median(byRun);
  const validation = segments.filter(leg => heldOut.includes(leg.name)).map(leg => ({name:leg.name,
    runs:leg.measurements.map(({run, phoneMs, macMs}) => {
      const predictedMs = macMs * ratio, errorMs = Math.abs(predictedMs - phoneMs);
      return {run, measuredMs:phoneMs, predictedMs, errorFraction:phoneMs === 0 ? null : errorMs / phoneMs,
        pass:errorMs <= phoneMs * 0.25};
    })}));
  const observation = cadenceObservation(pairs,training,ratio,validation);
  const qualified = observation === null && validation.every(leg => leg.runs.every(run => run.pass));
  return {qualified, build:first.version.build, rendererRevision:first.version.rendererRevision,
    raster:{css:first.witness.css,dpr:first.witness.dpr}, metric:'p95', training, heldOut, ratio,
    spread:{min:Math.min(...byRun),max:Math.max(...byRun)}, byRun, segments, validation, observation,
    reason:observation !== null ? 'Phone observations are dominated by cadence; these capped frames cannot qualify a GPU ratio.' :
      qualified ? 'All held-out predictions are within 25% in every matched run.' :
      'At least one held-out prediction differs by more than 25%; do not use this ratio in the floor table.'};
}

/** @typedef {{build:string|null, css:number[], dpr:number|null, gpu?:string|null, legs:{name:string, frames:number, ms:number|null, error?:string|null}[]}} FencedCapture */

/** A phone route-bench run (route.json row) with --fenced-gpu, as a FencedCapture. Pure.
 * @param {{boot?:{build?:string|null}, raster?:{css?:number[], dpr?:number}, legs?:{name:string, error?:string|null, probe?:{frames?:number, tailMeanMs?:number|null}|null}[]}} row
 * @returns {FencedCapture} */
export function fencedFromRouteBench(row) {
  return { build: row.boot?.build ?? null, css: row.raster?.css ?? [], dpr: row.raster?.dpr ?? null, gpu: null,
    legs: (row.legs ?? []).map(leg => ({ name: leg.name, frames: leg.probe?.frames ?? 0, ms: leg.probe?.tailMeanMs ?? null, error: leg.error ?? null })) };
}

/** A Mac measureFps cold capture with fencedEvery, as a FencedCapture. Pure.
 * @param {{witness?:{build?:string|null, css?:number[], dpr?:number, gpu?:string|null}, legs?:{name:string, error?:string|null, fencedGpu?:{frames?:number, tailMeanMs?:number|null}}[]}} cold
 * @returns {FencedCapture} */
export function fencedFromMeasure(cold) {
  return { build: cold.witness?.build ?? null, css: cold.witness?.css ?? [], dpr: cold.witness?.dpr ?? null, gpu: cold.witness?.gpu ?? null,
    legs: (cold.legs ?? []).map(leg => ({ name: leg.name, frames: leg.fencedGpu?.frames ?? 0, ms: leg.fencedGpu?.tailMeanMs ?? null, error: leg.error ?? null })) };
}

/** DF5 with an observable the 30 fps cap cannot clamp: both sides fence the same frames (gpuProbe.mjs), so each
 * segment's ratio is phone fenced GPU ms over Mac fenced GPU ms. Same rules as fitGpu: three matched runs, the ratio from
 * training segments only, every held-out run predicted within 25%.
 * @param {{phone:FencedCapture, mac:FencedCapture}[]} pairs @param {string[]} training @param {string[]} heldOut
 * @param {number} [minFrames] fenced frames each leg needs */
export function fitFencedGpu(pairs, training, heldOut, minFrames = 20) {
  if (pairs.length < 3) throw new Error('DF5 needs at least three independent matched route pairs');
  const assigned = [...training, ...heldOut];
  if (training.length === 0 || heldOut.length < 2 || new Set(assigned).size !== assigned.length)
    throw new Error('Declare disjoint training and at least two held-out segments');
  const build = pairs[0].phone.build, css = JSON.stringify(pairs[0].phone.css);
  for (const { phone, mac } of pairs) {
    for (const side of [phone, mac]) {
      if (side.build === null || side.build !== build) throw new Error('Matched captures need the same build');
      if (side.dpr !== 1 || JSON.stringify(side.css) !== css) throw new Error('Matched captures need the same raster at DPR 1');
    }
    if (!/metal/iu.test(mac.gpu ?? '') || /software|swiftshader/iu.test(mac.gpu ?? '')) throw new Error('GPU fit requires hardware Metal measurements');
  }
  const segments = assigned.map(name => {
    const measurements = pairs.map(({ phone, mac }, run) => {
      const p = phone.legs.find(leg => leg.name === name), m = mac.legs.find(leg => leg.name === name);
      if (p === undefined || m === undefined || p.frames < minFrames || m.frames < minFrames || !(Number(p.ms) > 0) || !(Number(m.ms) > 0))
        throw new Error(`Missing fenced frames for ${name} in run ${String(run + 1)}`);
      if ((p.error ?? null) !== null || (m.error ?? null) !== null) throw new Error(`A complete route is required: ${name} in run ${String(run + 1)} did not finish`);
      const phoneMs = /** @type {number} */ (p.ms), macMs = /** @type {number} */ (m.ms);
      return { run: run + 1, phoneMs, macMs, phoneFrames: p.frames, macFrames: m.frames, ratio: phoneMs / macMs };
    });
    const ratios = measurements.map(row => row.ratio);
    return { name, role: training.includes(name) ? 'training' : 'held-out', ratio: median(ratios),
      spread: { min: Math.min(...ratios), max: Math.max(...ratios) }, measurements };
  });
  const byRun = pairs.map((_, run) => median(segments.filter(leg => leg.role === 'training').map(leg => leg.measurements[run].ratio)));
  const ratio = median(byRun);
  const validation = segments.filter(leg => leg.role === 'held-out').map(leg => ({ name: leg.name,
    runs: leg.measurements.map(({ run, phoneMs, macMs }) => {
      const predictedMs = macMs * ratio, errorMs = Math.abs(predictedMs - phoneMs);
      return { run, measuredMs: phoneMs, predictedMs, errorFraction: errorMs / phoneMs, pass: errorMs <= phoneMs * 0.25 };
    }) }));
  const qualified = validation.every(leg => leg.runs.every(run => run.pass));
  return { qualified, build, raster: { css: pairs[0].phone.css, dpr: 1 }, metric: 'fenced GPU tail, 10% trimmed mean (gpuProbe.mjs)',
    training, heldOut, ratio, spread: { min: Math.min(...byRun), max: Math.max(...byRun) }, byRun, segments, validation,
    reason: qualified ? 'All held-out predictions are within 25% in every matched run.' :
      'At least one held-out prediction differs by more than 25%; do not use this ratio in the floor table.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {values} = parseArgs({options:{manifest:{type:'string'},out:{type:'string'},fenced:{type:'boolean'}}});
  if (!values.manifest || !values.out) throw new Error('Use --manifest <pairs.json> --out <fit.json>');
  const manifestPath = resolve(values.manifest), folder = resolve(manifestPath, '..');
  const read = (/** @type {string} */ file) => JSON.parse(readFileSync(resolve(folder,file),'utf8'));
  const manifest = read(manifestPath);
  // --fenced: pairs are { phone: { file: route.json, run: index }, mac: { file: measureFps cold capture } }
  const report = values.fenced === true
    ? fitFencedGpu(manifest.pairs.map((/** @type {{phone:{file:string,run:number},mac:{file:string}}} */ pair) =>
      ({ phone: fencedFromRouteBench(read(pair.phone.file)[pair.phone.run]), mac: fencedFromMeasure(read(pair.mac.file)) })), manifest.training, manifest.heldOut)
    : fitGpu(manifest.pairs.map((/** @type {{phone:string,mac:string}} */ pair) => ({phone:read(pair.phone),mac:read(pair.mac)})), manifest.route, manifest.training, manifest.heldOut);
  writeFileSync(values.out,`${JSON.stringify(report,null,2)}\n`);
  console.log(report.reason);
  process.exitCode = report.qualified ? 0 : 2;
}
