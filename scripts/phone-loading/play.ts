/** DL24 (G1008): the first seconds of play after control on the phone link, as DL23 drives them on the Simulator
 *  (scripts/loading-flow/drive.mjs): walk forward with a slow look for 10 s, then the hoverboard at Developer boost, judged
 *  on the game's own drawn frames (its 120-slot `frameMs` ring; it paces its draws, so the page's rAF can tick while the
 *  world draws at 5 fps). Jake's bar: the shard's normal fps from second 1 and no frame over 250 ms. */
export interface PlayFrame {at: number; ms: number}
export interface PlayTrack {at: number; x: number; z: number; v: number; hover: boolean; boost: boolean; phase: string}
/** A change of the renderer's program or texture count, sampled once a page frame. */
export interface PlayGpu {at: number; programs: number; textures: number; added?: string[]}
export interface PlayCapture {start: number; seconds: number; frames: PlayFrame[]; pageGaps: PlayFrame[]; track: PlayTrack[]; phase: string; gpu?: PlayGpu[]}
export interface PlayReading {
  seconds: number; startAfterControlMs: number | null; frames: number; fps: number; perSecond: number[];
  firstSecondFps: number; settledFps: number; lowestFirst5: number; longestFrameMs: number; framesOver250: number;
  pageGapsOver250: number; longestPageGapMs: number;
  /** Frames over 100 ms: seconds into the window, their length, and the programs and textures that appeared across them. */
  slowFrames: {s: number; ms: number; programs: number; textures: number}[];
  /** Programs and textures the renderer gained over the window (the first sample to the last), and when each program appeared. */
  gained: {programs: number; textures: number; programAt: number[]; added?: string[]};
  motion: {walkM: number; boostM: number; boostEngaged: boolean; boostTopMps: number};
  pass: {noFrameOver250ms: boolean; steadyFromSecondOne: boolean; walkedAndBoosted: boolean};
}

/** The in-page driver and collector (a string, evaluated in the world page at control). */
export function playScript(seconds: number): string {
  return `(() => { const w = window.__wildshard?.world; if (!w || window.__plPlay) return 'skip';
  const g = w.game, input = g.app.input, p = w.player, t0 = performance.now(), S = ${String(seconds)};
  const out = window.__plPlay = { start: performance.timeOrigin + t0, seconds: S, frames: [], pageGaps: [], track: [], phase: 'walk', gpu: [] };
  const info = g.renderer.info, known = new Set(); let programs = -1, textures = -1;
  let last = t0, seen = g.frameCount, raf = t0, tracked = 0;
  const step = () => { const now = performance.now(), s = (now - t0) / 1000, dt = (now - last) / 1000; last = now;
    if (s >= S) { input.setHeld('move.forward', false); p.hoverBoost = false; out.phase = 'done'; return; }
    input.setHeld('move.forward', true); p.yaw += 0.5 * dt;
    if (s >= 10) { if (out.phase === 'walk') { p.setHover(true); out.phase = 'boost'; } p.hoverBoost = true; }
    setTimeout(step, 16); };
  const sample = () => { const now = performance.now();
    if (now - raf > 250) out.pageGaps.push({ at: performance.timeOrigin + now, ms: now - raf }); raf = now;
    const p0 = info.programs?.length ?? 0, t1 = info.memory.textures;
    if (p0 !== programs || t1 !== textures) {
      const list = info.programs ?? [], added = programs < 0 ? [] : list.filter(row => !known.has(row)).map(row => String(row.name) + ' ' + String(row.cacheKey).slice(0, 160));
      for (const row of list) known.add(row);
      programs = p0; textures = t1; out.gpu.push({ at: performance.timeOrigin + now, programs: p0, textures: t1, added }); }
    const size = g.frameMs.length, k = Math.min(size, g.frameCount - seen); seen = g.frameCount;
    let at = now;
    const fresh = [];
    for (let j = 0; j < k; j++) { const ms = g.frameMs[(g.frameI - 1 - j + size * 2) % size]; fresh.push({ at: performance.timeOrigin + at, ms }); at -= ms; }
    out.frames.push(...fresh.reverse());
    if (now - tracked >= 250) { tracked = now; const r = v => Math.round(v * 100) / 100;
      out.track.push({ at: performance.timeOrigin + now, x: r(p.position.x), z: r(p.position.z), v: r(Math.hypot(p.velocity.x, p.velocity.z)), hover: p.hover, boost: p.hoverBoost, phase: out.phase }); }
    if ((now - t0) / 1000 < S + 0.5) requestAnimationFrame(sample); };
  step(); requestAnimationFrame(sample); return 'ok'; })()`;
}

export const PLAY_READ = 'JSON.stringify(window.__plPlay ?? null)';

const round = (value: number, places = 1): number => Math.round(value * 10 ** places) / 10 ** places;

/** Jake's bar on one capture: per-second drawn frames over the window, the longest frame, and the motion it covered. */
export function playReading(capture: PlayCapture, control: number | null): PlayReading {
  const end = capture.start + capture.seconds * 1000;
  const inside = capture.frames.filter(frame => frame.at > capture.start && frame.at <= end);
  const perSecond = Array.from({length: capture.seconds}, (_, second) =>
    inside.filter(frame => frame.at > capture.start + second * 1000 && frame.at <= capture.start + (second + 1) * 1000).length);
  // the frame open at the window's start counts too: its time is the first drawn frame's
  const longest = inside.reduce((max, frame) => Math.max(max, frame.ms), 0);
  const settled = perSecond.slice(10).sort((a, b) => a - b), settledFps = settled[Math.floor(settled.length / 2)] ?? 0;
  const motion = {walkM: 0, boostM: 0, boostEngaged: false, boostTopMps: 0};
  for (let i = 1; i < capture.track.length; i++) {
    const a = capture.track[i - 1], b = capture.track[i];
    if (a === undefined || b === undefined) continue;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (b.phase === 'boost') { motion.boostM += d; motion.boostEngaged ||= b.boost && b.hover; motion.boostTopMps = Math.max(motion.boostTopMps, b.v); }
    else if (b.phase === 'walk') motion.walkM += d;
  }
  const over250 = inside.filter(frame => frame.ms > 250).length, pageOver = capture.pageGaps.filter(gap => gap.at <= end && gap.ms > 250);
  const lowestFirst5 = Math.min(...perSecond.slice(0, 5));
  const gpu = capture.gpu ?? [], counts = (at: number): PlayGpu | undefined => {
    let found: PlayGpu | undefined;
    for (const row of gpu) if (row.at <= at) found = row;
    return found;
  };
  const slowFrames = inside.filter(frame => frame.ms > 100).map(frame => {
    const before = counts(frame.at - frame.ms), after = counts(frame.at + 50);
    return {s: round((frame.at - capture.start) / 1000, 2), ms: round(frame.ms), programs: (after?.programs ?? 0) - (before?.programs ?? 0),
      textures: (after?.textures ?? 0) - (before?.textures ?? 0)};
  });
  const first = gpu[0], last = gpu.at(-1), programAt: number[] = [];
  for (let i = 1; i < gpu.length; i++) { const row = gpu[i], previous = gpu[i - 1]; if (row !== undefined && previous !== undefined && row.programs > previous.programs) programAt.push(round((row.at - capture.start) / 1000, 2)); }
  const gained = {programs: (last?.programs ?? 0) - (first?.programs ?? 0), textures: (last?.textures ?? 0) - (first?.textures ?? 0), programAt, added: gpu.flatMap(row => row.added ?? [])};
  return {gained, slowFrames, seconds: capture.seconds, startAfterControlMs: control === null ? null : round(capture.start - control), frames: inside.length,
    fps: round(inside.length / capture.seconds), perSecond, firstSecondFps: perSecond[0] ?? 0, settledFps, lowestFirst5,
    longestFrameMs: round(longest), framesOver250: over250, pageGapsOver250: pageOver.length,
    longestPageGapMs: round(capture.pageGaps.reduce((max, gap) => gap.at <= end ? Math.max(max, gap.ms) : max, 0)),
    motion: {walkM: round(motion.walkM), boostM: round(motion.boostM), boostEngaged: motion.boostEngaged, boostTopMps: round(motion.boostTopMps)},
    pass: {noFrameOver250ms: inside.length > 0 && over250 === 0 && pageOver.length === 0,
      steadyFromSecondOne: settledFps > 0 && perSecond.slice(0, 5).every(n => n >= 0.8 * settledFps),
      walkedAndBoosted: motion.walkM >= 5 && motion.boostEngaged && motion.boostM > motion.walkM}};
}

/** A page's JSON capture, checked field by field (it crosses the CDP boundary as text). */
export function parsePlayCapture(text: string): PlayCapture | null {
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null) return null;
  const read = (key: string): unknown => Reflect.get(value, key);
  const start = read('start'), seconds = read('seconds'), frames = read('frames'), pageGaps = read('pageGaps'), track = read('track'), phase = read('phase');
  if (typeof start !== 'number' || typeof seconds !== 'number' || !Array.isArray(frames) || !Array.isArray(pageGaps) || !Array.isArray(track) || typeof phase !== 'string') return null;
  const frame = (row: unknown): PlayFrame => {
    const at: unknown = typeof row === 'object' && row !== null ? Reflect.get(row, 'at') : null, ms: unknown = typeof row === 'object' && row !== null ? Reflect.get(row, 'ms') : null;
    if (typeof at !== 'number' || typeof ms !== 'number') throw new Error('Invalid play frame');
    return {at, ms};
  };
  const point = (row: unknown): PlayTrack => {
    if (typeof row !== 'object' || row === null) throw new Error('Invalid play track');
    const get = (key: string): unknown => Reflect.get(row, key);
    const at = get('at'), x = get('x'), z = get('z'), v = get('v'), hover = get('hover'), boost = get('boost'), rowPhase = get('phase');
    if (typeof at !== 'number' || typeof x !== 'number' || typeof z !== 'number' || typeof v !== 'number' || typeof hover !== 'boolean'
      || typeof boost !== 'boolean' || typeof rowPhase !== 'string') throw new Error('Invalid play track');
    return {at, x, z, v, hover, boost, phase: rowPhase};
  };
  const gpuRows = read('gpu');
  const gpu = Array.isArray(gpuRows) ? gpuRows.map((row: unknown): PlayGpu => {
    const get = (key: string): unknown => typeof row === 'object' && row !== null ? Reflect.get(row, key) : null;
    const at = get('at'), programs = get('programs'), textures = get('textures');
    if (typeof at !== 'number' || typeof programs !== 'number' || typeof textures !== 'number') throw new Error('Invalid play GPU row');
    const added = get('added');
    return {at, programs, textures, ...(Array.isArray(added) ? {added: added.map(String)} : {})};
  }) : undefined;
  return {start, seconds, frames: frames.map(frame), pageGaps: pageGaps.map(frame), track: track.map(point), phase, ...(gpu === undefined ? {} : {gpu})};
}
