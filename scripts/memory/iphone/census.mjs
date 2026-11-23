// meta DRIFTWOOD-FPS DF9 / IPHONE13-DRIFTWOOD DW4 (mini-driftwood13d): who draws the triangles, on the device itself. Some
// cold phone boots draw ~1.2 M triangles in ~111 draws where most draw ~0.75 M in ~85 at the same pose, and a desktop census
// never shows the high mode, so the owners have to be read on the phone. `route-bench.mjs --census` runs this at the end of
// the route.

/** In the page (an async WebDriver body: `arguments[0]` frames, the callback last): every draw of the next frames,
 * summed by its pass (main or shadow) and its owner (the first four names from the scene down), per frame. Must not close
 * over anything outside itself. */
export const OWNER_CENSUS = `
const frames = arguments[0], done = arguments[arguments.length - 1];
const g = window.__wildshard?.world?.game, r = g?.renderer;
if (r === undefined) { done({ error: 'no game' }); return; }
const owners = new Map(); let shadow = 0;
const draw = r.renderBufferDirect, shadowRender = r.shadowMap.render;
r.renderBufferDirect = function (...args) {
  const tris = r.info.render.triangles, calls = r.info.render.calls;
  try { return draw.apply(this, args); } finally {
    const chain = [];
    for (let n = args[4]; n; n = n.parent) chain.push(n.name === '' ? n.type : n.name);
    const key = (shadow > 0 ? 'shadow' : 'main') + '|' + chain.reverse().slice(0, 4).join('>');
    const o = owners.get(key) ?? [0, 0];
    o[0] += r.info.render.calls - calls; o[1] += r.info.render.triangles - tris; owners.set(key, o);
  }
};
r.shadowMap.render = function (...args) { shadow++; try { return shadowRender.apply(this, args); } finally { shadow--; } };
const start = g.frameCount;
const tick = () => {
  if (g.frameCount < start + frames) { requestAnimationFrame(tick); return; }
  r.renderBufferDirect = draw; r.shadowMap.render = shadowRender;
  const n = g.frameCount - start, rows = [...owners].map(([k, [c, t]]) => [k, Math.round(c / n * 10) / 10, Math.round(t / n)]);
  rows.sort((a, b) => b[2] - a[2]);
  const quality = { phone: g.phoneGraphics ?? null, low: g.qualityLow ?? null, shadowsOff: g.qualityShadowsOff ?? null,
    casters: [], device: (() => { try { return JSON.parse(localStorage.getItem('wildshard.save.v2@2.device') ?? '{}').keys?.graphics?.data ?? null; } catch { return null; } })() };
  g.rootScene?.traverse?.((o) => { if (o.isLight && o.castShadow) quality.casters.push((o.name || o.type) + ' ' + String(o.shadow?.mapSize?.x ?? '?')); });
  done({ frames: n, shadowAuto: r.shadowMap.autoUpdate, quality, pack: window.__vertexPackStats ?? null, last: g.lastFrame ?? null, owners: rows.slice(0, 40) });
};
requestAnimationFrame(tick);
`;

/** In the page (a WebDriver body): time every procedural voice render (Voices.variant: a prewarm slice, or a play that
 * finds its family unrendered) from now on, by family, against the page clock. DW3: the pier's first-turn bursts were
 * main-thread renders, not GPU work. */
export const VOICE_LOG_START = `
const voices = window.__wildshard?.world?.audio?.voices;
if (voices === undefined || typeof voices.variant !== 'function') return 'no voices';
const log = (window.__wsVoiceLog = []), render = voices.variant;
voices.variant = function (name, v, ch) {
  const t = performance.now();
  try { return render.call(this, name, v, ch); } finally { log.push([name, v, ch ?? -1, Math.round(t), Math.round((performance.now() - t) * 10) / 10]); }
};
return 'logging';
`;

/** In the page: the voice renders logged since VOICE_LOG_START: [family, variant, channel, page ms, render ms]. */
export const VOICE_LOG_READ = `return window.__wsVoiceLog ?? null;`;

/** In the page: the voice prewarm worker's state (on, booting/ready/off, spawns, boot ms, worker renders, drop reason), DF8. */
export const VOICE_WORKER_READ = `return window.__wildshard?.world?.audio?.voices?.warmWorker ?? null;`;

/** In the page (a WebDriver body): from now on, every frame's interval (rAF to rAF) with what the GL context did in it:
 * program links (and the new programs' names), every collider the page builds (its ms and triangles), renderer.render calls (more than the usual world and composite draws can show offscreen work), texture uploads (count, texels), buffer bytes, triangles and geometry
 * count, and every object added to or removed from the scene graph (lights left out; removes start with '-'). DW3 (mini-driftwood13e): the dock stands still, so its frames over
 * 50 ms have to be something arriving, not something turning into view. */
export const FRAME_LOG_START = `
const g = window.__wildshard?.world?.game, r = g?.renderer;
if (r === undefined) return 'no game';
const gl = r.getContext(), log = (window.__wsFrameLog = { count: 0, from: 0, frames: [], adds: [] });
let cur = { links: 0, tex: 0, texels: 0, buf: 0, renders: 0, uloc: 0, ulocProgs: new Set(), slow: 0, slowName: '' };
const render = r.render; r.render = function (...args) { cur.renders++; return render.apply(this, args); };
// DF8 (mini-driftwood13h): the frame's slowest single draw (renderBufferDirect: a first draw's vertex pack and upload, a
// first use's uniform lookups) and what it drew, so a long render names its object
const direct = r.renderBufferDirect;
r.renderBufferDirect = function (camera, scene, geometry, material, object, group) { const t = performance.now();
  try { return direct.call(this, camera, scene, geometry, material, object, group); } finally { const ms = performance.now() - t;
    if (ms > cur.slow) { cur.slow = ms; cur.slowName = (object?.parent?.name || object?.parent?.type || '') + '>' + (object?.name || object?.type || '?'); } } };
const wrap = (name, count) => { const own = gl[name]; if (typeof own !== 'function') return;
  gl[name] = function (...args) { count(args); return own.apply(this, args); }; };
wrap('linkProgram', () => { cur.links++; });
// DF8 (mini-driftwood13f): a program's first uniform lookups wait for its link (and ANGLE Metal's library build): time them
// per frame and name the programs, so a long frame with no link in it can still name the shader it waited on
const glNames = new WeakMap(), nameOf = (program) => { let name = glNames.get(program);
  if (name === undefined) { for (const p of r.info.programs ?? []) if (p.program === program) { name = p.name ?? '?'; glNames.set(program, name); } }
  return name ?? '?'; };
const ownUloc = gl.getUniformLocation;
gl.getUniformLocation = function (program, name) { const t = performance.now();
  try { return ownUloc.call(this, program, name); } finally { const ms = performance.now() - t; cur.uloc += ms; if (ms > 1) cur.ulocProgs.add(nameOf(program)); } };
const texels = (a) => { for (const x of a) if (x && typeof x === 'object' && 'width' in x) return (x.width | 0) * (x.height | 0);
  const n = a.filter((x) => typeof x === 'number'); return n.length >= 5 ? (n[3] | 0) * (n[4] | 0) : 0; };
for (const n of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'texStorage2D', 'compressedTexImage2D', 'compressedTexSubImage2D'])
  wrap(n, (a) => { cur.tex++; cur.texels += texels(a); });
const bufferBytes = (data, start = 0, count = 0) => {
  if (typeof data === 'number') return data;
  const stride = data?.BYTES_PER_ELEMENT ?? 1;
  return count > 0 ? count * stride : Math.max(0, (data?.byteLength ?? 0) - start * stride);
};
wrap('bufferData', (a) => { cur.buf += bufferBytes(a[1], a[3], a[4]); });
wrap('bufferSubData', (a) => { cur.buf += bufferBytes(a[2], a[3], a[4]); });
const seen = new Set(r.info.programs?.map((p) => p.id) ?? []);
const proto = Object.getPrototypeOf(g.scene); let o3 = proto; while (o3 && !Object.prototype.hasOwnProperty.call(o3, 'add')) o3 = Object.getPrototypeOf(o3);
const note = (sign, parent, kids) => { try { if (log.adds.length < 600) for (const k of kids) { if (k.isLight) continue; let tris = 0;
  k.traverse?.((m) => { const geo = m.geometry; if (geo) tris += (geo.index ? geo.index.count : (geo.attributes?.position?.count ?? 0)) / 3 * (m.count ?? 1); });
  log.adds.push([Math.round(performance.now()), sign + (parent.name || parent.type) + '>' + (k.name || k.type), Math.round(tris)]); } } catch {} };
const add = o3?.add, remove = o3?.remove;
if (add) o3.add = function (...kids) { note('', this, kids); return add.apply(this, kids); };
if (remove) o3.remove = function (...kids) { note('-', this, kids); return remove.apply(this, kids); };
// colliders built on the page (Rapier, main thread), every physics world (a grid page swaps frame worlds, so the hook is on
// the shared ColliderSet class): [page ms, build ms, triangles]
const sets = window.__wildshard?.world?.physics?.world?.colliders, setProto = sets ? Object.getPrototypeOf(sets) : null, create = setProto?.createCollider;
log.colliders = [];
if (typeof create === 'function') setProto.createCollider = function (bodies, desc, parent) {
  const t = performance.now();
  try { return create.call(this, bodies, desc, parent); } finally {
    const tris = desc?.shape?.indices?.length ? desc.shape.indices.length / 3 : 0;
    if (log.colliders.length < 2000) log.colliders.push([Math.round(t), Math.round((performance.now() - t) * 10) / 10, tris]); } };
// DF8 (mini-driftwood13i): calls that wait on the GPU (pixel reads, framebuffer checks, a canvas copied into a 2D canvas,
// the game's frame captures) and page timers whose callback ran 8 ms or more: [page ms, name, ms]
log.reads = []; log.tasks = [];
const timed = (target, name, label, keep) => { const own = target?.[name]; if (typeof own !== 'function') return;
  target[name] = function (...args) { const t = performance.now();
    try { return own.apply(this, args); } finally { const ms = performance.now() - t; if (ms >= 2 && log.reads.length < 2000 && (keep === undefined || keep(args))) log.reads.push([Math.round(t), label, Math.round(ms * 10) / 10]); } }; };
for (const n of ['readPixels', 'checkFramebufferStatus', 'finish', 'clientWaitSync', 'getBufferSubData', 'getError']) timed(gl, n, 'gl.' + n);
const c2 = window.CanvasRenderingContext2D?.prototype;
timed(c2, 'getImageData', '2d.getImageData');
timed(c2, 'drawImage', '2d.drawImage(canvas)', (a) => a[0] instanceof HTMLCanvasElement);
if (typeof g.captureFrame === 'function') { const cap = g.captureFrame; g.captureFrame = function (...args) { const t = performance.now();
  log.reads.push([Math.round(t), 'game.captureFrame ask', 0]); return cap.apply(this, args); }; }
const timer = (name) => { const own = window[name]; window[name] = function (fn, ...rest) {
  if (typeof fn !== 'function') return own.call(window, fn, ...rest);
  const label = name + ':' + (fn.name || String(fn).slice(0, 60).replace(/\\s+/g, ' '));
  return own.call(window, function (...a) { const t = performance.now();
    try { return fn.apply(this, a); } finally { const ms = performance.now() - t; if (ms >= 8 && log.tasks.length < 2000) log.tasks.push([Math.round(t), label, Math.round(ms)]); } }, ...rest); }; };
timer('setTimeout'); timer('setInterval');
// DF8: every game system's run is timed; a frame keeps the systems that took over 15 ms (id:ms)
let slowSystems = [];
// mini-driftwood13i: each system's runs, total ms, runs over 5 and 15 ms and its longest, so a spike reads as steady work or a one-off
const sysHist = log.sysHist = {};
// mini-driftwood13i: the player's predicted steps and replays (a server correction steps the buffered commands again), so a
// long player.step says how many steps it ran
let netSteps = 0, netReplays = 0;
try { const pl = window.__wildshard?.world?.player, ownNet = pl?.stepNet;
  if (typeof ownNet === 'function') pl.stepNet = function (dt, command, replay) { netSteps++; if (replay) netReplays++; return ownNet.call(this, dt, command, replay); }; } catch {}
try { const byPhase = g.app.systemsByPhase(), wrapped = new WeakSet();
  for (const phase of Object.keys(byPhase)) for (const spec of byPhase[phase]) {
    if (wrapped.has(spec) || typeof spec.run !== 'function') continue; wrapped.add(spec);
    const own = spec.run; try { spec.run = function (...args) { const t = performance.now();
      try { return own.apply(this, args); } finally { const ms = performance.now() - t; if (ms > 15) slowSystems.push(String(spec.id) + ':' + Math.round(ms) + (spec.id === 'player.step' ? '(steps ' + netSteps + ' replays ' + netReplays + ')' : ''));
        if (spec.id === 'player.step') { netSteps = 0; netReplays = 0; }
        const h = sysHist[spec.id] ??= [0, 0, 0, 0, 0]; h[0]++; h[1] += ms; if (ms > 5) h[2]++; if (ms > 15) h[3]++; if (ms > h[4]) h[4] = ms; } }; } catch {} } } catch {}
// DF8: the game's own update and render ms for its last two frames (Game's rings), so a long frame says which side it was
const gameSplit = () => { try { const ring = g.frameMs.length, a = (g.frameI - 1 + ring) % ring, b = (g.frameI - 2 + ring) % ring;
  return [Math.round(g.updateMs[a]), Math.round(g.renderMs[a]), Math.round(g.updateMs[b]), Math.round(g.renderMs[b])]; } catch { return null; } };
// DF8 (mini-driftwood13g): the game's own frame-cost split (core/frameCost.ts, on for the log's life): every update over 30 ms
// with its buckets, its longest system and the unbucketed parts (each system by name, event delivery, phase scheduling,
// frame preparation): [page ms, update ms, render ms, top system:ms, parts]
const fc = window.__wildshard?.frameCost, BUCKETS = ['physics', 'animals', 'elites', 'player', 'hud', 'audio', 'world', 'quest'];
log.costs = [];
// mini-driftwood13m: updates over 18 ms (the one-off 21 to 35 ms stalls) and parts of 1 ms or more, so a stall in the grid's
// late step names its part (DF13's laps: grid.late view cover, rings, life, bands, frame, ring tiles)
if (fc && typeof fc === 'object') { fc.on = true; fc.onFrame = (f) => { if (f.update <= 18 || log.costs.length >= 400) return;
  const parts = []; BUCKETS.forEach((b, i) => { const v = f.buckets[i] ?? 0; if (v >= 1) parts.push(b + ':' + Math.round(v)); });
  for (const [k, v] of f.otherParts) if (v >= 1) parts.push(k + ':' + Math.round(v));
  log.costs.push([Math.round(f.t), Math.round(f.update), Math.round(f.render), f.top + ':' + Math.round(f.topMs), parts.join(',')]); }; }
let last = performance.now(), previous = null;
const tick = (now) => { if (window.__wsFrameLog !== log) return;
  const progs = r.info.programs ?? [], fresh = [];
  for (const p of progs) if (!seen.has(p.id)) { seen.add(p.id); fresh.push(p.name ?? '?'); }
  const frame = [Math.round(now), Math.round((now - last) * 10) / 10, cur.links, cur.tex, cur.texels, cur.buf, r.info.render.triangles, r.info.memory.geometries, fresh.join(','), cur.renders, Math.round(cur.uloc * 10) / 10, [...cur.ulocProgs].join(','), gameSplit(), slowSystems.join(','), cur.slow >= 5 ? [Math.round(cur.slow), cur.slowName] : null];
  if (log.count++ === 0) log.from = frame[0];
  // Keep the events and their immediate predecessors as they arrive, including the dock at the start of a long route.
  if (frame[1] > 45 || cur.links > 0 || cur.texels > 65536 || cur.buf > 65536 || cur.renders > 2 || frame[10] > 5 || slowSystems.length > 0) {
    if (previous !== null && log.frames[log.frames.length - 1] !== previous) log.frames.push(previous);
    log.frames.push(frame);
  }
  previous = frame; slowSystems = [];
  last = now; cur = { links: 0, tex: 0, texels: 0, buf: 0, renders: 0, uloc: 0, ulocProgs: new Set(), slow: 0, slowName: '' }; requestAnimationFrame(tick); };
requestAnimationFrame(tick);
return 'logging';
`;

/** In the page: FRAME_LOG_START's log, and stop logging: { count, frames: [page ms, interval ms, links, tex uploads,
 * texels, buffer bytes, triangles, geometries, new programs, renderer.render calls, uniform-lookup ms, programs looked up
 * slowly, the game's update/render split, systems over 15 ms, the slowest draw [ms, parent>object] when 5 ms or more], adds: [page ms, parent>child, triangles], costs: FRAME_LOG_START's update splits, reads: [page ms, GPU-waiting call, ms], tasks: [page ms, timer, ms] }. Only the frames
 * that are long (over 45 ms), link, or upload more than 64k texels or 64 KB, and the frame before each, so the socket
 * holds it. */
export const FRAME_LOG_READ = `
const log = window.__wsFrameLog ?? null; window.__wsFrameLog = undefined;
const fc = window.__wildshard?.frameCost; if (fc && typeof fc === 'object') { fc.on = false; fc.onFrame = null; }
if (log === null) return null;
const f = log.frames;
// mini-driftwood13m: with \`debug.taskStamp\` on (core/taskStamp.ts), each frame over 45 ms's stamped callbacks (the 8 longest,
// [start, ms, label]) and its late probes (the longest and the sum, ms): [frame page ms, stamps, longest late, late sum,
// collections the probe's sentinel saw in it]
const ts = window.__wsTaskStamp, stamps = [];
if (ts && typeof ts.read === 'function') for (const x of f) if (x[1] > 45) { const from = x[0] - x[1], late = ts.lates(from, x[0]);
  stamps.push([x[0], ts.read(from, x[0]).sort((a, b) => b[1] - a[1]).slice(0, 8), late.reduce((m, l) => Math.max(m, l[1]), 0), late.reduce((m, l) => m + l[1], 0), typeof ts.collections === 'function' ? ts.collections(from, x[0]).length : null]); }
return { count: log.count, from: log.from, stamps: ts ? stamps : null, frames: f, adds: log.adds, colliders: log.colliders, costs: log.costs ?? [], reads: log.reads ?? [], tasks: log.tasks ?? [], sys: Object.entries(log.sysHist ?? {}).filter(([, h]) => h[3] > 0).map(([id, h]) => [id, h[0], Math.round(h[1]), h[2], h[3], Math.round(h[4])]) };
`;

/**
 * DF8 (mini-driftwood13h): what each frame over `over` ms waited on, from FRAME_LOG_READ's frames and the inspector's
 * collections ([type, start ms, end ms] on the page clock). A frame's interval runs from the previous rAF's start to
 * this one's, so the game frame inside it is the previous tick's (its update/render split, systems, links, uploads),
 * read from the frame before when the log kept it and from this frame's older split otherwise. Causes, strongest first:
 * `gc` (a collection overlapping the interval by 10 ms or more), `compile` (a link or 5 ms of first uniform lookups),
 * `upload` (1 MB of buffers or a million texels), `update` and `render` (20 ms or more), else `other`.
 * @param {any[][]} frames @param {[string, number, number][]} [collections] @param {number} [over]
 * @returns {{ at: number, ms: number, cause: string, causes: string[] }[]}
 */
export function nameLongFrames(frames, collections = [], over = 50) {
  /** @type {{ at: number, ms: number, cause: string, causes: string[] }[]} */
  const named = [];
  frames.forEach((f, i) => {
    const ms = Number(f[1]);
    if (!(ms > over)) return;
    const end = Number(f[0]), start = end - ms, prev = frames[i - 1];
    const before = prev !== undefined && Math.abs(Number(prev[0]) - start) <= 2 ? prev : null;
    const split = /** @type {unknown[] | null} */ (f[12] ?? null), last = /** @type {unknown[] | null} */ (before?.[12] ?? null);
    const update = Number((before !== null ? last?.[0] : split?.[2]) ?? 0), render = Number((before !== null ? last?.[1] : split?.[3]) ?? 0);
    /** @type {string[]} */
    const causes = [];
    let gc = 0; const kinds = new Set();
    for (const [type, s, e] of collections) { const lap = Math.min(e, end) - Math.max(s, start); if (lap > 0) { gc += lap; kinds.add(type); } }
    if (gc >= 10) causes.push(`gc ${[...kinds].join('+')} ${String(Math.round(gc))}`);
    if (before !== null && (Number(before[2]) > 0 || Number(before[10] ?? 0) >= 5)) { const names = [before[8], before[11]].map(String).find((n) => n !== '' && n !== 'undefined') ?? '?'; causes.push(`compile ${names}`); }
    if (before !== null && (Number(before[5]) >= 1e6 || Number(before[4]) >= 1e6)) causes.push(`upload ${(Number(before[5]) / 1e6).toFixed(1)} MB`);
    if (update >= 20) causes.push(`update ${String(update)}${before?.[13] ? ` ${String(before[13])}` : ''}`);
    const slow = /** @type {[number, string] | null} */ (before?.[14] ?? null);
    if (render >= 20) causes.push(`render ${String(render)}${slow === null ? '' : ` (draw ${String(slow[0])} ms ${slow[1]})`}`);
    named.push({ at: end, ms, cause: (causes[0] ?? 'other').split(' ')[0] ?? 'other', causes });
  });
  return named;
}

/**
 * DF8 (mini-driftwood13i): what ran inside each long frame's interval outside the game's own tick, from FRAME_LOG_READ's
 * GPU-waiting calls (pixel reads, canvas copies) and page timers of 8 ms or more, each `name:ms`, the longest first.
 * @param {{ at: number, ms: number }[]} named @param {{ reads?: [number, string, number][], tasks?: [number, string, number][] }} log
 * @returns {string[][]}
 */
export function gapWork(named, log) {
  return named.map((n) => {
    const start = n.at - n.ms, end = n.at;
    /** @type {[number, string][]} */ const found = [];
    for (const [t, name, ms] of [...(log.reads ?? []), ...(log.tasks ?? [])]) if (t + ms > start && t < end) found.push([ms, `${name}:${String(Math.round(ms))}`]);
    // mini-driftwood13m: `debug.taskStamp`'s callbacks in the frame (FRAME_LOG_READ's stamps) and how late its probe ran
    const stamped = (log.stamps ?? []).find((s) => s[0] === n.at);
    if (stamped !== undefined) {
      for (const [, ms, label] of stamped[1]) found.push([ms, `${label}:${String(Math.round(ms))}`]);
      found.push([-1, `probe late max ${String(stamped[2])} sum ${String(stamped[3])}${stamped[4] === undefined || stamped[4] === null ? '' : ` gc ${String(stamped[4])}`}`]);
    }
    return found.sort((a, b) => b[0] - a[0]).slice(0, 9).map((f) => f[1]);
  });
}

/**
 * mini-driftwood13m: an `other` frame (no game work, link, upload or collection) split by `debug.taskStamp`: `task` (a
 * stamped callback of 20 ms or more outside the game's own frame callback ran in it), `held` (the probe ran 20 ms or more
 * late with no such callback (`held gc` when the probe's sentinel saw a collection in it): work nothing wraps, as an `await` continuation, style and layout or a collection the Heap
 * agent missed) or `free` (the probe ran on time: the main thread was free, so the frame waited elsewhere). Null without
 * the stamps. Pure.
 * @param {{ at: number, ms: number, cause: string }} n @param {{ stamps?: [number, [number, number, string][], number, number, (number | null)?][] | null }} log
 * @param {(label: string) => boolean} [gameFrame] the game's own frame callback (the shared frame scheduler's driver, an
 *   anonymous arrow that reads `this.epoch`) and the log's own tick, left out
 * @returns {string | null}
 */
export function otherKind(n, log, gameFrame = (label) => label === 'raf:tick' || (label.startsWith('raf:') && label.includes('epoch'))) {
  const stamped = (log.stamps ?? []).find((s) => s[0] === n.at);
  if (stamped === undefined) return null;
  const task = stamped[1].find(([, ms, label]) => ms >= 20 && !gameFrame(label));
  if (task !== undefined) return `task ${task[2]}`;
  if (stamped[2] < 20) return 'free';
  return (stamped[4] ?? 0) > 0 ? 'held gc' : 'held';
}
