// NB6 regression ceilings, measured 2026-11-16 on NB1's street route
// (0b9fe2d8), phone 402x874 @2, CPU x4, Nine rev 2 + 21413ff0.
// These hold today's 0.904 M / 119 draws with noise room. NB8/NB23's
// improvement targets remain in the plan. Never record a new baseline on red.
export const NINE_LIMITS = Object.freeze({triangles95: 1_020_000, draws95: 132,
  fps: 25, frame95: 65, gpu95: 30, controlMs: 40_000, shadersMs: 6500, firstFrameMs: 8000});

/** @typedef {{fps:number,p95:number,gpu95:number,draws95:number,tris95:number}} FrameSummary */
/** @typedef {{renderer:string,seconds:number,throttle:number,dpr:number,phone:boolean,
 * load:{phases:{control:number},stage:{op:string,ms:number}[]},
 * play:{pixelRatio:number,all:FrameSummary,minutes:FrameSummary[],
 * route:{name:string,reached:number,stuck:unknown[],path:number[][]}}}} NineReading */

/** Refuse missing evidence as well as regressions. SwiftShader's raster time
 * cannot measure phone speed; it still submits the same geometry and draws.
 * @param {NineReading} reading @returns {string[]} */
export function nineFaults(reading) {
  const {play, load} = reading, faults = [];
  if (!/nine/u.test(play.route.name) || !reading.phone || reading.throttle !== 4 || reading.dpr !== 2 || play.pixelRatio !== 2 || reading.seconds < 60)
    faults.push('NB6 needs the Nine street route, phone 402x874 @2, CPU x4, at least 60 seconds');
  if (play.route.reached < 10 || play.route.stuck.length > 2 ||
    !play.route.path.some(row => row[2] <= -85) || !play.route.path.some(row => row[1] >= 30))
    faults.push('NB6 street route incomplete or stuck (south street and stair street required)');
  if (play.minutes.length < Math.floor(reading.seconds / 60)) faults.push('NB6 missing complete frame minutes');
  const software = /swiftshader|llvmpipe|software/iu.test(reading.renderer);
  if (!reading.renderer) faults.push('NB6 renderer identity missing');
  /** @param {string} label @param {number} value @param {number} limit @param {boolean} [floor] */
  const hold = (label, value, limit, floor = false) => {
    if (!Number.isFinite(value) || value <= 0 || (floor ? value < limit : value > limit))
      faults.push(`NB6 ${label}: ${value} outside ${floor ? 'minimum' : 'maximum'} ${limit}`);
  };
  for (const [i, minute] of [play.all, ...play.minutes].entries()) {
    const label = i === 0 ? 'walk' : `minute ${i}`;
    hold(`${label} triangles p95`, minute.tris95, NINE_LIMITS.triangles95);
    hold(`${label} draws p95`, minute.draws95, NINE_LIMITS.draws95);
    if (!software) {
      hold(`${label} fps`, minute.fps, NINE_LIMITS.fps, true);
      hold(`${label} frame p95`, minute.p95, NINE_LIMITS.frame95);
      // gpu~ can be zero when work stays inside the 30 fps cap.
      if (!Number.isFinite(minute.gpu95) || minute.gpu95 < 0 || minute.gpu95 > NINE_LIMITS.gpu95) faults.push(`NB6 ${label} gpu~ p95: ${minute.gpu95}`);
    }
  }
  if (!software) {
    hold('control ms', load.phases.control, NINE_LIMITS.controlMs);
    for (const [stage, limit] of [['shaders', NINE_LIMITS.shadersMs], ['firstFrame', NINE_LIMITS.firstFrameMs]])
      hold(`${stage} ms`, load.stage.find(row => row.op === `stage:${stage}`)?.ms ?? Number.NaN, Number(limit));
  }
  return faults;
}
