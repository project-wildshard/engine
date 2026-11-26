// GPU attribution by subtraction at a standing pose (sp-o3; diagnostic, no timing credit). WebKit exposes no GPU timer
// queries, so on the Simulator a render-shaped standing miss is attributed by measuring the drawn cadence with one thing
// switched off at a time: each post pass, the shadow-map update, and each heavy scene subtree. The browser function runs
// as is in Safari and Chromium (frame-floor's evaluator) and restores everything it switched before it resolves.

/**
 * Browser side: `frames` drawn frames per variant (rAF timestamps between drawn frameCount changes, as frame-floor's
 * sampler). Returns the baseline, then one row per variant, each with its mean / p50 / p95 interval and game work p95.
 * @param {number} frames
 */
export async function gpuBisect(frames) {
  const g = window.__wildshard.world.game, root = g.rootScene;
  const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const measure = () => new Promise((resolve, reject) => {
    const intervals = [], work = [];
    let count = g.frameCount, last = -1;
    const timeout = setTimeout(() => reject(new Error('gpu bisect sampler stalled')), 30000);
    const tick = (t) => {
      if (g.frameCount !== count) {
        if (last >= 0) { intervals.push(t - last); work.push(g.workMs[(g.frameI + g.frameMs.length - 1) % g.frameMs.length]); }
        count = g.frameCount; last = t;
      }
      if (intervals.length < frames) { requestAnimationFrame(tick); return; }
      clearTimeout(timeout);
      const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(s.length * p) - 1)]; };
      const r = (v) => Math.round(v * 10) / 10;
      resolve({ meanMs: r(intervals.reduce((a, b) => a + b, 0) / intervals.length), p50Ms: r(pct(intervals, 0.5)), p95Ms: r(pct(intervals, 0.95)), workP95Ms: r(pct(work, 0.95)), calls: g.lastFrame.calls, triangles: g.lastFrame.triangles });
    };
    requestAnimationFrame(tick);
  });
  const run = async (variant, off, on) => { off(); try { await wait(400); return { variant, ...(await measure()) }; } finally { on(); await wait(200); } };
  const meshes = (o) => { let n = 0; o.traverseVisible((c) => { if (c.isMesh || c.isInstancedMesh || c.isPoints || c.isLine) n++; }); return n; };
  const label = (o) => `${o.name !== "" ? o.name : o.type}${o.userData?.tag ? `#${o.userData.tag}` : ''}`;
  // sp-o276: what the frame draws, by material type and program (no GL queries; three's own bookkeeping)
  const census = () => {
    const byType = new Map(), materials = new Set(); let draws = 0;
    root.traverseVisible((c) => {
      if (!(c.isMesh || c.isInstancedMesh || c.isPoints || c.isLine || c.isSkinnedMesh)) return;
      const list = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of list) { if (!m) continue; materials.add(m); draws++; const k = `${m.type}${c.castShadow ? '+cast' : ''}`; byType.set(k, (byType.get(k) ?? 0) + 1); }
    });
    return { draws, materials: materials.size, programs: g.renderer.info.programs?.length ?? -1, byType: Object.fromEntries([...byType].sort((a, b) => b[1] - a[1]).slice(0, 12)) };
  };
  // sp-o276: GL calls per drawn frame on the game's own context (counted for 30 frames, then unwrapped)
  const glCensus = async () => {
    const gl = g.renderer.getContext(), names = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'useProgram', 'bufferSubData', 'bufferData', 'bindBufferBase', 'bindTexture', 'uniformMatrix4fv', 'uniformMatrix3fv', 'uniform4fv', 'uniform3fv', 'uniform1f', 'uniform1i', 'bindFramebuffer', 'texImage2D', 'texSubImage2D'];
    const counts = Object.fromEntries(names.map((n) => [n, 0])); let ubo = 0;
    for (const n of names) { const f = gl[n]; if (typeof f !== 'function') continue; gl[n] = function counted(...a) { counts[n]++; if (n === 'bufferSubData' && a[0] === gl.UNIFORM_BUFFER) ubo++; return f.apply(this, a); }; }
    const start = g.frameCount; await new Promise((resolve) => { const t = () => { if (g.frameCount - start >= 30) resolve(); else requestAnimationFrame(t); }; requestAnimationFrame(t); });
    const drawn = g.frameCount - start;
    for (const n of names) delete gl[n];
    return { ...Object.fromEntries(Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v / drawn)])), uboSubData: Math.round(ubo / drawn) };
  };
  const rows = [{ variant: 'baseline', ...(await measure()), census: { ...census(), gl: await glCensus() } }];
  // the viewmodel (a camera child: the root-child scan skips the camera)
  for (const child of g.camera.children) if (child.visible && meshes(child) > 0) rows.push({ ...(await run(`hide camera/${label(child)}`, () => { child.visible = false; }, () => { child.visible = true; })), meshes: meshes(child) });
  // post passes (the first scene render stays)
  const passes = g.composer.passes;
  for (const [i, pass] of passes.entries()) {
    if (i === 0 || !pass.enabled) continue;
    const effects = (pass.effects ?? []).map((e) => (typeof e.name === "string" && e.name !== "" ? e.name : e.constructor?.name)).join('+');
    rows.push(await run(`pass ${i} ${typeof pass.name === "string" && pass.name !== "" ? pass.name : pass.constructor?.name}${effects ? ` (${effects})` : ''}`, () => { pass.enabled = false; }, () => { pass.enabled = true; }));
  }
  // the shadow maps' per-frame update
  if (g.renderer.shadowMap.enabled && g.renderer.shadowMap.autoUpdate) rows.push(await run('shadow map update', () => { g.renderer.shadowMap.autoUpdate = false; }, () => { g.renderer.shadowMap.autoUpdate = true; }));
  // heavy subtrees: the root's children, and the children of any root child holding over 40 visible meshes
  const candidates = [];
  for (const child of root.children) {
    if (!child.visible || child === g.camera) continue;
    const n = meshes(child);
    if (n === 0) continue;
    candidates.push({ o: child, n, path: label(child) });
    if (n > 40) for (const sub of child.children) { const m = sub.visible ? meshes(sub) : 0; if (m > 0) candidates.push({ o: sub, n: m, path: `${label(child)}/${label(sub)}` }); }
  }
  candidates.sort((a, b) => b.n - a.n);
  for (const c of candidates.slice(0, 20)) rows.push({ ...(await run(`hide ${c.path}`, () => { c.o.visible = false; }, () => { c.o.visible = true; })), meshes: c.n });
  rows.push({ variant: 'baseline again', ...(await measure()) });
  return rows;
}

/**
 * sp-o276: what the frames right after a pose change do (diagnostic, no timing credit). Called with no settle after a
 * teleport; records `frames` drawn frames: interval, game work, draw calls and the heavy GL calls of each, unwrapped after.
 * @param {number} frames
 */
export async function settleTrace(frames) {
  const g = window.__wildshard.world.game, gl = g.renderer.getContext();
  const heavy = ['texImage2D', 'texSubImage2D', 'compressedTexImage2D', 'compressedTexSubImage2D', 'texStorage2D', 'generateMipmap', 'bufferData', 'bufferSubData', 'linkProgram', 'compileShader', 'getProgramParameter', 'readPixels', 'bindFramebuffer', 'drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'useProgram', 'clear'];
  let cur = {}, bytes = 0;
  for (const n of heavy) {
    const f = gl[n]; if (typeof f !== 'function') continue;
    gl[n] = function traced(...a) { cur[n] = (cur[n] ?? 0) + 1; if (n === 'bufferData' && a[1] && typeof a[1] === 'object' && 'byteLength' in a[1]) bytes += a[1].byteLength; return f.apply(this, a); };
  }
  const rows = [], r = g.renderer, ownRender = Object.getOwnPropertyDescriptor(r, 'renderBufferDirect'), ownMain = Object.getOwnPropertyDescriptor(r, 'render');
  let owners = new Map(), passes = [];
  const owner = (o) => { const path = []; for (let c = o; c && path.length < 3; c = c.parent) if (c.name) path.unshift(c.name); return path.join('/') || o.type; };
  const draw = r.renderBufferDirect.bind(r), main = r.render.bind(r);
  r.renderBufferDirect = function renderBufferDirect(camera, scene, geometry, material, object, group) { const k = `${owner(object)} [${camera.type === 'OrthographicCamera' ? 'shadow' : 'view'}]`; owners.set(k, (owners.get(k) ?? 0) + 1); draw(camera, scene, geometry, material, object, group); };
  r.render = function render(scene, camera) { const t = r.getRenderTarget(); passes.push(`${scene.name === '' ? scene.type : scene.name}:${camera.name === '' ? camera.type : camera.name} to ${t ? `${t.width}x${t.height}` : 'screen'}`); main(scene, camera); };
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('settle trace stalled')), 60000);
      let count = g.frameCount, last = -1;
      const tick = (t) => {
        if (g.frameCount !== count) {
          if (last >= 0) rows.push({ ms: Math.round((t - last) * 10) / 10, work: Math.round(g.workMs[(g.frameI + g.frameMs.length - 1) % g.frameMs.length] * 10) / 10, calls: g.lastFrame.calls, gl: cur, bufferBytes: bytes, passes, owners: Object.fromEntries([...owners].sort((a, b) => b[1] - a[1]).slice(0, 14)) });
          cur = {}; bytes = 0; owners = new Map(); passes = []; count = g.frameCount; last = t;
        }
        if (rows.length < frames) { requestAnimationFrame(tick); return; }
        clearTimeout(timeout); resolve();
      };
      requestAnimationFrame(tick);
    });
  } finally {
    for (const n of heavy) delete gl[n];
    if (ownRender === undefined) Reflect.deleteProperty(r, 'renderBufferDirect'); else Object.defineProperty(r, 'renderBufferDirect', ownRender);
    if (ownMain === undefined) Reflect.deleteProperty(r, 'render'); else Object.defineProperty(r, 'render', ownMain);
  }
  return rows;
}
