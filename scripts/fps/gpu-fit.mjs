#!/usr/bin/env node
// DF5: fit only the declared training segments, then test untouched segments.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { signature } from './matrix.mjs';
import { fpsVerdict } from './verdict.mjs';

/** @typedef {{name:string,seconds:number}} Segment */
/** @typedef {{build:string,css:number[],dpr:number,phone:boolean,low:boolean,shadowsOff:boolean,gpu?:string}} Witness */
/** @typedef {{version:{build:string,rendererRevision:string},witness:Witness,
 * legs:(Parameters<typeof fpsVerdict>[0][number] & {cap:number|null,summary?:{gpuApproxP95Ms:number},
 * metal?:{frames:number,p95Ms:number|null}})[]}} Capture */
/** @typedef {{phone:Capture,mac:Capture}} Pair */

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b), at = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[at] : (sorted[at - 1] + sorted[at]) / 2;
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
  const qualified = validation.every(leg => leg.runs.every(run => run.pass));
  return {qualified, build:first.version.build, rendererRevision:first.version.rendererRevision,
    raster:{css:first.witness.css,dpr:first.witness.dpr}, metric:'p95', training, heldOut, ratio,
    spread:{min:Math.min(...byRun),max:Math.max(...byRun)}, byRun, segments, validation,
    reason:qualified ? 'All held-out predictions are within 25% in every matched run.' :
      'At least one held-out prediction differs by more than 25%; do not use this ratio in the floor table.'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {values} = parseArgs({options:{manifest:{type:'string'},out:{type:'string'}}});
  if (!values.manifest || !values.out) throw new Error('Use --manifest <pairs.json> --out <fit.json>');
  const manifestPath = resolve(values.manifest), folder = resolve(manifestPath, '..');
  const read = (/** @type {string} */ file) => JSON.parse(readFileSync(resolve(folder,file),'utf8'));
  const manifest = read(manifestPath);
  const pairs = manifest.pairs.map((/** @type {{phone:string,mac:string}} */ pair) => ({phone:read(pair.phone),mac:read(pair.mac)}));
  const report = fitGpu(pairs, manifest.route, manifest.training, manifest.heldOut);
  writeFileSync(values.out,`${JSON.stringify(report,null,2)}\n`);
  console.log(report.reason);
  process.exitCode = report.qualified ? 0 : 2;
}
