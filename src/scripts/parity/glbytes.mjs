// SF22b: WebGL allocation census installed before page scripts. Engine creation/upload labels are optional hooks.
export const GL_INIT = String.raw`(() => { const W = window;
  if (W.__sc_gl) return;
  // Storage mutations stay exact. Scene labels are flushed only when a reader asks for a census.
  W.__sc_gl_sample_labels = W.__sc_gl_full_labels !== true;
  const samplers = new Set();
  W.__sc_gl_register_labels = (flush) => { samplers.add(new WeakRef(flush)); };
  const sampleLabels = () => { for (const weak of samplers) { const flush=weak.deref(); if(flush)flush(); else samplers.delete(weak); } };
  const labels = new WeakMap(), sources = new WeakMap(), ids = new WeakMap(), uploads = new WeakMap(), storage = new WeakMap();
  let scope = null, sequence = 0, operation = null;
  const object = (v) => v !== null && (typeof v === 'object' || typeof v === 'function');
  const label = (resource, owner, asset) => { if (object(resource) && owner && asset) { const previous=labels.get(resource); if(previous?.owner===owner && previous.asset===asset)return; labels.set(resource, { owner, asset }); W.__sc_gl_change?.({at:Date.now()/1000,op:'label',id:identity(resource,'resource'),owner,asset}); } };
  W.__sc_label_gl = label;
  W.__sc_label_source = (source, owner, asset, identity) => { if (object(source) && owner && asset) sources.set(source, { owner, asset, identity: object(identity) ? new WeakRef(identity) : undefined }); };
  W.__sc_gl_scope = (owner, asset, fn) => { const previous = scope; scope = { owner, asset }; try { return fn(); } finally { scope = previous; } };
  const identity = (resource, kind) => { if (!ids.has(resource)) ids.set(resource, kind + ':' + (++sequence)); return ids.get(resource); };
  const fromSource = (resource, source) => { if (object(source)) uploads.set(resource, new WeakRef(source)); const tag = object(source) && sources.get(source); if (tag) { label(resource, tag.owner, tag.asset); const identity=tag.identity?.deref(); if(identity) storage.set(resource,new WeakRef(identity)); } };
  // Three may upload an internal geometry before its first draw supplies its source label.
  // Keep only a weak reference: census instrumentation must not retain released CPU arrays.
  const entry = (resource, kind, bytes) => {
    if (!labels.has(resource)) fromSource(resource, uploads.get(resource)?.deref());
    return { id: identity(resource, kind), kind, bytes, ...(labels.get(resource) ?? { owner: 'unlabelled', asset: 'unlabelled' }), labelled: labels.has(resource) };
  };
  // Scalar-only identity bridge: never return or retain source/GPU objects in a receipt.
  W.__sc_gl_id = (resource) => object(resource) ? ids.get(resource) ?? null : null;
  W.__sc_gl_source_ids = (source) => !object(source) ? [] : recs.flatMap(r => [...r.buf.keys()].filter(resource => (uploads.get(resource)?.deref() === source || storage.get(resource)?.deref() === source)).map(resource => identity(resource, 'buffer')));
  // Optional loading journal contains scalar identities only; it never retains GPU/source objects.
  const changed = (gl, resource, kind, bytes, dimensions = {}) => { if (W.__sc_gl_change) {const row=entry(resource,kind,bytes);W.__sc_gl_change({at:Date.now()/1000,op:'allocation',context:identity(gl,'context'),...row,bytes,operation,canvas:gl.canvas?.id??null,stage:W.__frameFloorGridStop?.phase??'boot',...dimensions});} };
  const changedTexture = (gl, resource) => { if (!W.__sc_gl_change) return; let bytes=0,width=0,height=0,depth=0,levels=0,internalFormat=null;
    for(const level of rec(gl).tex.get(resource)?.values() ?? []){bytes+=level.bytes;width=Math.max(width,level.w);height=Math.max(height,level.h);depth=Math.max(depth,level.d);levels++;internalFormat=level.ifmt;}
    changed(gl,resource,'texture',bytes,{width,height,depth,levels,internalFormat}); };
  // Lost contexts have no live allocations. Record the same retirement in the journal as in the census.
  const retire = (gl) => {
    const r = recOf.get(gl); if (!r || r.retired) return; r.retired=true;
    W.__sc_gl_change?.({at:Date.now()/1000,op:'context',context:identity(gl,'context'),state:'lost',canvas:gl.canvas?.id??null});
    for (const [field, kind] of [['tex', 'texture'], ['rb', 'renderbuffer'], ['buf', 'buffer']]) {
      for (const resource of r[field].keys()) changed(gl, resource, kind, null);
      r[field].clear();
    }
  };
  // GPU bytes at the WebGL API, per context: textures (per face + level), renderbuffers, buffers
  const SIZED = { 0x8229: 1, 0x822b: 2, 0x8051: 4, 0x8058: 4, 0x8c43: 4, 0x8c41: 4, 0x822d: 2, 0x822f: 4, 0x881b: 8, 0x881a: 8, 0x822e: 4, 0x8230: 8, 0x8815: 16, 0x8814: 16,
    0x8c3a: 4, 0x8c3d: 4, 0x8059: 4, 0x8d62: 2, 0x8056: 2, 0x8057: 2, 0x8232: 1, 0x8231: 1, 0x8234: 2, 0x8233: 2, 0x8236: 4, 0x8235: 4, 0x823a: 4, 0x823c: 8, 0x8d7c: 4, 0x8d76: 8,
    0x8d70: 16, 0x8d82: 16, 0x8f94: 1, 0x8f95: 2, 0x8f97: 4, 0x81a5: 2, 0x81a6: 4, 0x8cac: 4, 0x88f0: 4, 0x8cad: 8, 0x8d48: 1 };
  const COMP = { 0x1908: 4, 0x1907: 4, 0x190a: 2, 0x1909: 1, 0x1906: 1, 0x1902: 1, 0x84f9: 1, 0x1903: 1 };
  const TYPE = { 0x1401: 1, 0x1400: 1, 0x1403: 2, 0x1402: 2, 0x1405: 4, 0x1404: 4, 0x1406: 4, 0x140b: 2, 0x8d61: 2 };
  const PACKED = { 0x8363: 2, 0x8033: 2, 0x8034: 2, 0x84fa: 4, 0x8368: 4, 0x8c3b: 4, 0x8c3e: 4, 0x8dad: 8 };
  const BLOCK = {}; // compressed: [block w, block h, bytes]
  for (const f of [0x83f0, 0x83f1, 0x8c4c, 0x8c4d, 0x8dbb, 0x8dbc, 0x9270, 0x9271, 0x9274, 0x9275, 0x9276, 0x9277, 0x8d64]) BLOCK[f] = [4, 4, 8];
  for (const f of [0x83f2, 0x83f3, 0x8c4e, 0x8c4f, 0x8dbd, 0x8dbe, 0x8e8c, 0x8e8d, 0x8e8e, 0x8e8f, 0x9272, 0x9273, 0x9278, 0x9279]) BLOCK[f] = [4, 4, 16];
  const ASTC = [[4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8], [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12]];
  ASTC.forEach(([bw, bh], i) => { BLOCK[0x93b0 + i] = [bw, bh, 16]; BLOCK[0x93d0 + i] = [bw, bh, 16]; });
  const texelBytes = (ifmt, format, type) => SIZED[ifmt] ?? (PACKED[type] ?? (COMP[ifmt] ?? COMP[format] ?? 4) * (TYPE[type] ?? 1));
  const imgBytes = (ifmt, w, h, d, format, type) => {
    const b = BLOCK[ifmt];
    if (b) return Math.ceil(w / b[0]) * Math.ceil(h / b[1]) * b[2] * d;
    if (ifmt === 0x8c00 || ifmt === 0x8c02) return Math.max(w, 8) * Math.max(h, 8) / 2 * d;
    if (ifmt === 0x8c01 || ifmt === 0x8c03) return Math.max(w, 16) * Math.max(h, 8) / 4 * d;
    return w * h * d * texelBytes(ifmt, format, type);
  };
  const recs = []; const recOf = new WeakMap();
  const rec = (gl) => { let r = recOf.get(gl); if (!r) { r = { gl, tex: new Map(), rb: new Map(), buf: new Map(), compressed: 0, listening: false, retired: false }; recOf.set(gl, r); recs.push(r);
      W.__sc_gl_change?.({at:Date.now()/1000,op:'context',context:identity(gl,'context'),state:'observed',canvas:gl.canvas?.id??null});
    } else if(r.retired){r.retired=false;W.__sc_gl_change?.({at:Date.now()/1000,op:'context',context:identity(gl,'context'),state:'restored',canvas:gl.canvas?.id??null});}
    // Observe delivered loss once, rearming only if the restored context allocates again.
    // Never wrap extensions or synchronously query the driver after loseContext().
    if(!r.listening && gl.canvas?.addEventListener){r.listening=true;gl.canvas.addEventListener('webglcontextlost',()=>{r.listening=false;retire(gl);},{once:true});}
    return r; };
  const texBinding = (gl, target) => {
    if (target === 0x0de1) return gl.getParameter(0x8069);
    if (target === 0x8513 || (target >= 0x8515 && target <= 0x851a)) return gl.getParameter(0x8514);
    if (target === 0x806f) return gl.getParameter(0x806a);
    if (target === 0x8c1a) return gl.getParameter(0x8c1d);
    return null;
  };
  const face = (target) => (target >= 0x8515 && target <= 0x851a ? target - 0x8515 : 0);
  const setLevel = (gl, target, level, info) => {
    const t = texBinding(gl, target); if (!t) return;
    const r = rec(gl); let e = r.tex.get(t); if (!e) { e = new Map(); r.tex.set(t, e); }
    e.set(face(target) * 64 + level, info); if (scope && !labels.has(t)) label(t, scope.owner, scope.asset);
    changedTexture(gl,t);
  };
  const srcDims = (s) => s ? [s.naturalWidth || s.videoWidth || s.displayWidth || s.codedWidth || s.width || 0, s.naturalHeight || s.videoHeight || s.displayHeight || s.codedHeight || s.height || 0] : [0, 0];
  const BUF_BIND = { 0x8892: 0x8894, 0x8893: 0x8895, 0x8a11: 0x8a28, 0x8f36: 0x8f36, 0x8f37: 0x8f37, 0x88eb: 0x88ed, 0x88ec: 0x88ef, 0x8c8e: 0x8c8f };
  const hook = (proto) => {
    if (!proto) return;
    const wrap = (name, after) => { const orig = proto[name]; if (typeof orig !== 'function') return; proto[name] = function wrapped(...a) { const r = orig.apply(this, a), previous=operation; operation=name; try { after(this, a, r); } catch {} finally{operation=previous;} return r; }; };
    for (const [method, kind, field] of [['createTexture', 'texture', 'tex'], ['createRenderbuffer', 'renderbuffer', 'rb'], ['createBuffer', 'buffer', 'buf']]) {
      wrap(method, (gl, _args, resource) => { if (!resource) return; const r = rec(gl); r[field].set(resource, kind === 'texture' ? new Map() : 0); identity(resource, kind); if (scope) label(resource, scope.owner, scope.asset); changed(gl,resource,kind,0); });
    }
    wrap('texImage2D', (gl, a) => {
      const [target, level, ifmt] = a; let w, h, format, type;
      if (a.length >= 8) { w = a[3]; h = a[4]; format = a[6]; type = a[7]; } else { format = a[3]; type = a[4]; [w, h] = srcDims(a[5]); }
      setLevel(gl, target, level, { w, h, d: 1, ifmt, format, type, bytes: imgBytes(ifmt, w, h, 1, format, type) }); fromSource(texBinding(gl, target), a.length >= 8 ? a[8] : a[5]);
    });
    wrap('texImage3D', (gl, a) => { const [target, level, ifmt, w, h, d, , format, type] = a; setLevel(gl, target, level, { w, h, d, ifmt, format, type, bytes: imgBytes(ifmt, w, h, d, format, type) }); });
    wrap('copyTexImage2D', (gl, a) => { const [target, level, ifmt, , , w, h] = a; setLevel(gl, target, level, { w, h, d: 1, ifmt, bytes: imgBytes(ifmt, w, h, 1) }); });
    wrap('compressedTexImage2D', (gl, a) => { const [target, level, ifmt, w, h] = a; rec(gl).compressed++; setLevel(gl, target, level, { w, h, d: 1, ifmt, bytes: imgBytes(ifmt, w, h, 1) }); });
    wrap('compressedTexImage3D', (gl, a) => { const [target, level, ifmt, w, h, d] = a; rec(gl).compressed++; setLevel(gl, target, level, { w, h, d, ifmt, bytes: imgBytes(ifmt, w, h, d) }); });
    wrap('texStorage2D', (gl, a) => {
      const [target, levels, ifmt, w, h] = a; if (BLOCK[ifmt]) rec(gl).compressed++;
      const faces = target === 0x8513 ? [0x8515, 0x8516, 0x8517, 0x8518, 0x8519, 0x851a] : [target];
      for (const f of faces) for (let l = 0; l < levels; l++) { const lw = Math.max(1, w >> l), lh = Math.max(1, h >> l); setLevel(gl, f === target ? target : f, l, { w: lw, h: lh, d: 1, ifmt, bytes: imgBytes(ifmt, lw, lh, 1) }); }
    });
    wrap('texStorage3D', (gl, a) => {
      const [target, levels, ifmt, w, h, d] = a; if (BLOCK[ifmt]) rec(gl).compressed++;
      for (let l = 0; l < levels; l++) { const lw = Math.max(1, w >> l), lh = Math.max(1, h >> l), ld = target === 0x806f ? Math.max(1, d >> l) : d; setLevel(gl, target, l, { w: lw, h: lh, d: ld, ifmt, bytes: imgBytes(ifmt, lw, lh, ld) }); }
    });
    wrap('generateMipmap', (gl, a) => {
      const [target] = a; const t = texBinding(gl, target); const e = t && rec(gl).tex.get(t); if (!e) return;
      for (const [k, info] of [...e]) {
        if (k % 64 !== 0) continue;
        let { w, h, d } = info; const is3d = target === 0x806f;
        for (let l = 1; w > 1 || h > 1 || (is3d && d > 1); l++) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); if (is3d) d = Math.max(1, d >> 1); e.set(k + l, { ...info, w, h, d, bytes: imgBytes(info.ifmt, w, h, d, info.format, info.type) }); }
      }
      changedTexture(gl,t);
    });
    wrap('deleteTexture', (gl, a) => { recOf.get(gl)?.tex.delete(a[0]); if(a[0]) changed(gl,a[0],'texture',null); });
    const rbSet = (gl, samples, ifmt, w, h) => { const b = gl.getParameter(0x8ca7); if (b) {const bytes=w * h * (SIZED[ifmt] ?? 4) * Math.max(1, samples);rec(gl).rb.set(b,bytes);changed(gl,b,'renderbuffer',bytes,{width:w,height:h,samples,internalFormat:ifmt});} };
    wrap('renderbufferStorage', (gl, a) => { rbSet(gl, 1, a[1], a[2], a[3]); });
    wrap('renderbufferStorageMultisample', (gl, a) => { rbSet(gl, a[1], a[2], a[3], a[4]); });
    wrap('deleteRenderbuffer', (gl, a) => { recOf.get(gl)?.rb.delete(a[0]); if(a[0]) changed(gl,a[0],'renderbuffer',null); });
    wrap('bufferData', (gl, a) => {
      const bind = BUF_BIND[a[0]]; const b = bind && gl.getParameter(bind); if (!b) return;
      const s = a[1]; rec(gl).buf.set(b, typeof s === 'number' ? s : (s && s.byteLength) || 0); fromSource(b, s); if (scope && !labels.has(b)) label(b, scope.owner, scope.asset);
      changed(gl,b,'buffer',rec(gl).buf.get(b));
    });
    wrap('deleteBuffer', (gl, a) => { recOf.get(gl)?.buf.delete(a[0]); if(a[0]) changed(gl,a[0],'buffer',null); });
  };
  hook(W.WebGL2RenderingContext && W.WebGL2RenderingContext.prototype);
  hook(W.WebGLRenderingContext && W.WebGLRenderingContext.prototype);
  // The live storage per context, summed without listing or labelling a resource: the frame floor's once-a-second ledger.
  W.__sc_gl_totals = () => recs.filter((r) => !r.gl.isContextLost()).map((r) => { let totalBytes = 0;
    for (const e of r.tex.values()) for (const i of e.values()) totalBytes += i.bytes;
    for (const b of r.rb.values()) totalBytes += b; for (const b of r.buf.values()) totalBytes += b; return { totalBytes }; });
  W.__sc_gl = () => { sampleLabels(); for (const r of recs) if(r.gl.isContextLost())retire(r.gl); return recs.filter((r) => !r.gl.isContextLost()).map((r) => {
    let tex = 0, levels = 0; const per = [], resources = [];
    for (const [resource, e] of r.tex) { let b = 0, l0 = null; for (const [k, i] of e) { b += i.bytes; levels++; if (k === 0) l0 = i; } tex += b; per.push([b, l0 ? l0.w + 'x' + l0.h + (l0.d > 1 ? 'x' + l0.d : '') : '?', l0 ? '0x' + l0.ifmt.toString(16) : '?', e.size]); resources.push({ ...entry(resource, 'texture', b), subresources: [...e].map(([key, info]) => ({ face: Math.floor(key / 64), level: key % 64, ...info })) }); }
    per.sort((a, b) => b[0] - a[0]);
    let rb = 0; for (const [resource, bytes] of r.rb) { rb += bytes; resources.push(entry(resource, 'renderbuffer', bytes)); }
    let buf = 0; for (const [resource, bytes] of r.buf) { buf += bytes; resources.push(entry(resource, 'buffer', bytes)); }
    resources.sort((a, b) => b.bytes - a.bytes || a.asset.localeCompare(b.asset) || a.id.localeCompare(b.id)); const totalBytes = tex + rb + buf; const listedBytes = resources.reduce((sum, row) => sum + row.bytes, 0);
    const c = r.gl.canvas; return { resources, totalBytes, listedBytes, reconciled: listedBytes === totalBytes, unlabelled: resources.filter((row) => !row.labelled).length, gl: r.gl, canvas: c ? [c.width, c.height] : null, texBytes: tex, textures: r.tex.size, levels, top: per.slice(0, 12), rbBytes: rb, bufBytes: buf, buffers: r.buf.size, compressedUploads: r.compressed };
  }); };
})();`;

/** Explicit hot-path diagnostic mode; frame floors never select it. */
export const GL_FULL_INIT = ['window.__sc_gl_full_labels=true;', GL_INIT].join('');
