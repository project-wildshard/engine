export async function overdraw(wantHeat) {
  const w = window.__wildshard?.world, g = w.game, r = g.renderer, P = window.__gpuCensus;
  const W = r.domElement.width, H = r.domElement.height;
  const RT = g.composer.inputBuffer.constructor; // THREE.WebGLRenderTarget (no THREE global in the page)
  const rt = new RT(W, H, { depthBuffer: true });
  rt.texture.colorSpace = '';
  const mats = new Map();
  const meshes = P.meshes().filter((o) => (o.renderOrder ?? 0) < 999 && P.groupOf(o) !== 'viewmodel');
  const hidden = [];
  g.rootScene.traverse((o) => { if (o.visible && (o.renderOrder >= 999 || P.groupOf(o) === 'viewmodel') && o.isMesh) hidden.push(o); });
  for (const o of meshes) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m && !mats.has(m)) mats.set(m, null);
  const channel = (m) => (m.transparent ? 2 : m.alphaTest > 0 ? 1 : 0);
  const patch = (keepAlpha) => {
    for (const m of mats.keys()) {
      const saved = mats.get(m) ?? { obc: m.onBeforeCompile, key: m.customProgramCacheKey, blending: m.blending, bs: m.blendSrc, bd: m.blendDst, be: m.blendEquation, bsa: m.blendSrcAlpha, bda: m.blendDstAlpha, bea: m.blendEquationAlpha, dt: m.depthTest, dw: m.depthWrite, at: m.alphaTest, pa: m.premultipliedAlpha, cw: m.colorWrite };
      mats.set(m, saved);
      const c = channel(m), v = ['0.0', '0.0', '0.0']; v[c] = '1.0';
      m.onBeforeCompile = function onBeforeCompile(s, rr) {
        saved.obc.call(this, s, rr);
        const fs = s.fragmentShader, end = fs.lastIndexOf('}');
        const named = fs.match(/out\s+(?:highp\s+|mediump\s+)?vec4\s+(\w+)/);
        const out = /gl_FragColor/.test(fs) || named === null ? 'gl_FragColor' : named[1];
        s.fragmentShader = `${fs.slice(0, end)}\n  ${out} = vec4(${v.join(', ')}, 0.0) / 255.0;\n}\n`;
      };
      m.customProgramCacheKey = function customProgramCacheKey() { return `${saved.key.call(this)}|od${c}${keepAlpha ? 'k' : 'r'}`; };
      // CustomBlending (5), AddEquation (100), OneFactor (201) both ways: every fragment adds its channel
      m.blending = 5; m.blendEquation = 100; m.blendSrc = 201; m.blendDst = 201; m.blendEquationAlpha = 100; m.blendSrcAlpha = 201; m.blendDstAlpha = 201;
      m.depthTest = false; m.depthWrite = false; m.premultipliedAlpha = false; m.colorWrite = true;
      if (!keepAlpha) m.alphaTest = 0;
      m.needsUpdate = true;
    }
  };
  const restore = () => {
    for (const [m, s] of mats) {
      if (s === null) continue;
      m.onBeforeCompile = s.obc; m.customProgramCacheKey = s.key; m.blending = s.blending; m.blendSrc = s.bs; m.blendDst = s.bd; m.blendEquation = s.be;
      m.blendSrcAlpha = s.bsa; m.blendDstAlpha = s.bda; m.blendEquationAlpha = s.bea; m.depthTest = s.dt; m.depthWrite = s.dw; m.alphaTest = s.at; m.premultipliedAlpha = s.pa; m.colorWrite = s.cw;
      m.needsUpdate = true;
    }
  };
  const colorOwner = [...mats.keys()].find((m) => m.color !== undefined);
  const clearC = colorOwner ? r.getClearColor(colorOwner.color.clone()) : null;
  const bg = g.rootScene.background, autoSh = r.shadowMap.autoUpdate, clearA = r.getClearAlpha();
  const pass = (keepAlpha) => {
    patch(keepAlpha);
    g.rootScene.background = null; r.shadowMap.autoUpdate = false;
    for (const o of hidden) o.visible = false;
    const prev = r.getRenderTarget(), ac = r.autoClear;
    try {
      r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(true, true, true);
      r.autoClear = false;
      r.render(g.rootScene, g.camera);
    } finally {
      r.autoClear = ac; r.setRenderTarget(prev);
      for (const o of hidden) o.visible = true;
      g.rootScene.background = bg; r.shadowMap.autoUpdate = autoSh;
      if (clearC !== null) r.setClearColor(clearC, clearA); else r.setClearAlpha(clearA);
    }
    const out = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(rt, 0, 0, W, H, out);
    return out;
  };
  const stats = (buf) => {
    const n = W * H, chans = [0, 1, 2, 3].map(() => new Uint32Array(256));
    for (let i = 0; i < n; i++) {
      const a = buf[i * 4] ?? 0, b = buf[i * 4 + 1] ?? 0, c = buf[i * 4 + 2] ?? 0;
      chans[0][a]++; chans[1][b]++; chans[2][c]++; chans[3][Math.min(255, a + b + c)]++;
    }
    const sum = (h) => {
      let mean = 0, acc = 0, p50 = -1, p95 = -1, max = 0, over4 = 0;
      for (let v = 0; v < 256; v++) { const k = h[v]; if (k === 0) continue; mean += v * k; acc += k; max = v; if (p50 < 0 && acc >= n * 0.5) p50 = v; if (p95 < 0 && acc >= n * 0.95) p95 = v; if (v > 4) over4 += k; }
      return { mean: Number((mean / n).toFixed(2)), p50, p95, max, over4: Number((over4 / n).toFixed(3)) };
    };
    return { opaque: sum(chans[0]), alpha: sum(chans[1]), transparent: sum(chans[2]), total: sum(chans[3]) };
  };
  let kept, raster, heat = null;
  try {
    kept = pass(true);
    raster = pass(false);
  } finally { restore(); rt.dispose(); }
  if (wantHeat) {
    // the raster total at half size: 0 black · 1 blue · 2 cyan · 4 green · 8 yellow · 16 red · 32+ white
    const cw = Math.round(W / 2), ch = Math.round(H / 2);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(cw, ch);
    const ramp = [[0, 0, 0, 0], [1, 20, 40, 160], [2, 0, 150, 200], [4, 20, 190, 60], [8, 240, 220, 30], [16, 230, 40, 20], [32, 255, 255, 255]];
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const si = ((H - 1 - y * 2) * W + x * 2) * 4; // GL rows are bottom-up
      const v = (raster[si] ?? 0) + (raster[si + 1] ?? 0) + (raster[si + 2] ?? 0);
      let k = 0; while (k < ramp.length - 1 && (ramp[k + 1]?.[0] ?? 0) <= v) k++;
      const a = ramp[k] ?? [0, 0, 0, 0], b = ramp[Math.min(ramp.length - 1, k + 1)] ?? a;
      const f = b[0] === a[0] ? 0 : Math.min(1, (v - a[0]) / (b[0] - a[0]));
      const di = (y * cw + x) * 4;
      img.data[di] = a[1] + (b[1] - a[1]) * f; img.data[di + 1] = a[2] + (b[2] - a[2]) * f; img.data[di + 2] = a[3] + (b[3] - a[3]) * f; img.data[di + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    heat = await new Promise((resolve, reject) => {
      cv.toBlob(blob => {
        if (blob === null) reject(new Error('Heat image encoding refused'));
        else resolve(blob);
      }, 'image/jpeg', 0.8);
    });
  }
  return { w: W, h: H, layers: stats(kept), raster: stats(raster), heat };
}
