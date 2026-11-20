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
 * program links (and the new programs' names), every collider the page builds (its ms and triangles), renderer.render calls (more than one is an offscreen bake), texture uploads (count, texels), buffer bytes, triangles and geometry
 * count, and every object added to or removed from the scene graph (lights left out; removes start with '-'). DW3 (mini-driftwood13e): the dock stands still, so its frames over
 * 50 ms have to be something arriving, not something turning into view. */
export const FRAME_LOG_START = `
const g = window.__wildshard?.world?.game, r = g?.renderer;
if (r === undefined) return 'no game';
const gl = r.getContext(), log = (window.__wsFrameLog = { frames: [], adds: [] });
let cur = { links: 0, tex: 0, texels: 0, buf: 0, renders: 0, uloc: 0, ulocProgs: new Set() };
const render = r.render; r.render = function (...args) { cur.renders++; return render.apply(this, args); };
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
for (const n of ['bufferData', 'bufferSubData']) wrap(n, (a) => { const d = a[1]; cur.buf += typeof d === 'number' ? d : (d?.byteLength ?? 0); });
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
// DF8: every game system's run is timed; a frame keeps the systems that took over 15 ms (id:ms)
let slowSystems = [];
try { const byPhase = g.app.systemsByPhase(), wrapped = new WeakSet();
  for (const phase of Object.keys(byPhase)) for (const spec of byPhase[phase]) {
    if (wrapped.has(spec) || typeof spec.run !== 'function') continue; wrapped.add(spec);
    const own = spec.run; try { spec.run = function (...args) { const t = performance.now();
      try { return own.apply(this, args); } finally { const ms = performance.now() - t; if (ms > 15) slowSystems.push(String(spec.id) + ':' + Math.round(ms)); } }; } catch {} } } catch {}
// DF8: the game's own update and render ms for its last two frames (Game's rings), so a long frame says which side it was
const gameSplit = () => { try { const ring = g.frameMs.length, a = (g.frameI - 1 + ring) % ring, b = (g.frameI - 2 + ring) % ring;
  return [Math.round(g.updateMs[a]), Math.round(g.renderMs[a]), Math.round(g.updateMs[b]), Math.round(g.renderMs[b])]; } catch { return null; } };
let last = performance.now();
const tick = (now) => { if (window.__wsFrameLog !== log) return;
  const progs = r.info.programs ?? [], fresh = [];
  for (const p of progs) if (!seen.has(p.id)) { seen.add(p.id); fresh.push(p.name ?? '?'); }
  log.frames.push([Math.round(now), Math.round((now - last) * 10) / 10, cur.links, cur.tex, cur.texels, cur.buf, r.info.render.triangles, r.info.memory.geometries, fresh.join(','), cur.renders, Math.round(cur.uloc * 10) / 10, [...cur.ulocProgs].join(','), gameSplit(), slowSystems.join(',')]); slowSystems = [];
  if (log.frames.length > 4000) log.frames.shift();
  last = now; cur = { links: 0, tex: 0, texels: 0, buf: 0, renders: 0, uloc: 0, ulocProgs: new Set() }; requestAnimationFrame(tick); };
requestAnimationFrame(tick);
return 'logging';
`;

/** In the page: FRAME_LOG_START's log, and stop logging: { count, frames: [page ms, interval ms, links, tex uploads,
 * texels, buffer bytes, triangles, geometries, new programs, renderer.render calls, uniform-lookup ms, programs looked up
 * slowly], adds: [page ms, parent>child, triangles] }. Only the frames
 * that are long (over 45 ms), link, or upload more than 64k texels or 64 KB, and the frame before each, so the socket
 * holds it. */
export const FRAME_LOG_READ = `
const log = window.__wsFrameLog ?? null; window.__wsFrameLog = undefined;
if (log === null) return null;
const f = log.frames, keep = new Set();
f.forEach((x, i) => { if (x[1] > 45 || x[2] > 0 || x[4] > 65536 || x[5] > 65536 || x[9] > 1 || x[10] > 5 || (x[13] ?? '') !== '') { keep.add(i); if (i > 0) keep.add(i - 1); } });
return { count: f.length, from: f[0]?.[0] ?? 0, frames: [...keep].sort((a, b) => a - b).map((i) => f[i]), adds: log.adds, colliders: log.colliders };
`;
