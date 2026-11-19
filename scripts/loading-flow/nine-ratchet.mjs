// NB6 regression ceilings, measured 2026-11-16 on NB1's street route
// (0b9fe2d8), phone 402x874 @2, CPU x4, Nine rev 2 + 21413ff0.
// NB8/NB23's improvement targets remain in the plan. Never record a new baseline on red.
// BUDGET-CAPS BC11 (J444): the submitted work, triangles and draws at p95, is judged through the budget verdict against
// nine/street/triangles95 and nine/street/draws95 in budgets/baselines.json (0.904 M and 119 at the move; the old hand
// ceilings were 950,000 and 126). A new Nine revision is new content. The timing limits below stay one number each:
// they hold the physical MacBook, not content.
import {readBaselines,readCaps} from '../budgets/files.mjs';
import {judgeReads,zoneContentKey} from '../memory/ledgerVerdict.mjs';
import {pinnedContentKeys} from '../shard-size-gate.mjs';

export const NINE_LIMITS = Object.freeze({fps: 25, frame95: 65, gpu95: 30, controlMs: 40_000, shadersMs: 6500, firstFrameMs: 8000});
export const NINE_STREET_KEYS = Object.freeze({triangles95: 'nine/street/triangles95', draws95: 'nine/street/draws95'});

/** The committed budgets and Nine's pinned revision. */
export const nineJudging = () => ({contentKey: zoneContentKey('nine-dragon-stack', pinnedContentKeys()), budgets: {caps: readCaps(), baselines: readBaselines()}});

/** @typedef {{fps:number,p95:number,gpu95:number,draws95:number,tris95:number}} FrameSummary */
/** @typedef {{renderer:string,seconds:number,throttle:number,dpr:number,phone:boolean,
 * load:{phases:{control:number},stage:{op:string,ms:number}[]},
 * play:{pixelRatio:number,all:FrameSummary,minutes:FrameSummary[],
 * route:{name:string,reached:number,stuck:unknown[],path:number[][]}}}} NineReading */

/** Refuse missing evidence as well as regressions. Virtual/software GPU timing cannot be
 * compared with the physical MacBook baseline. Apple's hosted Paravirtual
 * device still reports Metal; it submits the same geometry and draws.
 * @param {NineReading} reading @param {ReturnType<typeof nineJudging>} [judging] @returns {string[]} */
export function nineFaults(reading, judging = nineJudging()) {
  const {play, load} = reading, faults = [];
  if (!/nine/u.test(play.route.name) || !reading.phone || reading.throttle !== 4 || reading.dpr !== 2 || play.pixelRatio !== 2 || reading.seconds < 60)
    faults.push('NB6 needs the Nine street route, phone 402x874 @2, CPU x4, at least 60 seconds');
  if (play.route.reached < 10 || play.route.stuck.length > 2 ||
    !play.route.path.some(row => row[2] <= -85) || !play.route.path.some(row => row[1] >= 30))
    faults.push('NB6 street route incomplete or stuck (south street and stair street required)');
  if (play.minutes.length < Math.floor(reading.seconds / 60)) faults.push('NB6 missing complete frame minutes');
  const virtual = /swiftshader|llvmpipe|software|paravirtual/iu.test(reading.renderer);
  if (!reading.renderer) faults.push('NB6 renderer identity missing');
  /** @param {string} label @param {number} value @param {number} limit @param {boolean} [floor] */
  const hold = (label, value, limit, floor = false) => {
    if (!Number.isFinite(value) || value <= 0 || (floor ? value < limit : value > limit))
      faults.push(`NB6 ${label}: ${value} outside ${floor ? 'minimum' : 'maximum'} ${limit}`);
  };
  /** @param {string} label @param {'tris95' | 'draws95'} field @param {string} key */
  const work = (label, field, key) => {
    const values = [play.all, ...play.minutes].map(minute => minute[field]);
    values.forEach((value, i) => { if (!Number.isFinite(value) || value <= 0) faults.push(`NB6 ${i === 0 ? 'walk' : `minute ${i}`} ${label}: ${value} outside maximum`); });
    if (values.some(value => !Number.isFinite(value) || value <= 0)) return;
    const row = judgeReads(judging.budgets, key, [Math.max(...values)], judging.contentKey);
    if (row.status === 'regressed' || row.status === 'over-hard')
      faults.push(`NB6 ${label}: ${row.value} ${row.status}, line ${Math.ceil(Number(row.status === 'over-hard' ? row.hard : row.line))} (baseline ${row.baseline} on ${judging.contentKey})`);
  };
  work('triangles p95', 'tris95', NINE_STREET_KEYS.triangles95);
  work('draws p95', 'draws95', NINE_STREET_KEYS.draws95);
  for (const [i, minute] of [play.all, ...play.minutes].entries()) {
    const label = i === 0 ? 'walk' : `minute ${i}`;
    if (!virtual) {
      hold(`${label} fps`, minute.fps, NINE_LIMITS.fps, true);
      hold(`${label} frame p95`, minute.p95, NINE_LIMITS.frame95);
      // gpu~ can be zero when work stays inside the 30 fps cap.
      if (!Number.isFinite(minute.gpu95) || minute.gpu95 < 0 || minute.gpu95 > NINE_LIMITS.gpu95) faults.push(`NB6 ${label} gpu~ p95: ${minute.gpu95}`);
    }
  }
  if (!virtual) {
    hold('control ms', load.phases.control, NINE_LIMITS.controlMs);
    for (const [stage, limit] of [['shaders', NINE_LIMITS.shadersMs], ['firstFrame', NINE_LIMITS.firstFrameMs]])
      hold(`${stage} ms`, load.stage.find(row => row.op === `stage:${stage}`)?.ms ?? Number.NaN, Number(limit));
  }
  return faults;
}
