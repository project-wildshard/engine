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
  done({ frames: n, shadowAuto: r.shadowMap.autoUpdate, last: g.lastFrame ?? null, owners: rows.slice(0, 40) });
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
