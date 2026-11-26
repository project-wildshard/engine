#!/usr/bin/env node
// vertex-census.mjs, the vertex census (meta docs/plans/MEMORY-STRUCTURE-PLAN.md STR11). One cold phone boot per zone in
// native WebKit (measure.mjs's webkitBoot: 402 x 874 @3, phone tier, Low, instrument minimal), online when --dist is
// given (STR1). A WebGL 2 shim, installed before the page's scripts, keeps every buffer's size and the attribute layout
// each draw reads (program attribute names, component type, size, stride, divisor) and every program's shader text.
// At control, after the settled reading, it reads the ledger's GL buffers [L] and poses the look loop's nine cameras at
// the spawn (cameras.mjs resolveCameras; FP 1-4 at the player, TOP and DIAG 5-9 up and out, all at the phone viewport),
// and counts one whole frame at each: draws, triangles (GL, and three's renderer.info), and vertex invocations per
// program with its live varyings (vertex outputs the fragment stage reads, after the preprocessor).
//
//   node src/scripts/memory/vertex-census.mjs --dist=<built client folder> --zones=a,b|all [--out=<dir>] [--settle=3]
//        [--url=<served client> instead of --dist: a standalone boot] [--query=<k=v&...>: a probe switch, trisprobe=half]
//        [--top=N: keep each frame's N heaviest passes, default 3; STR14 reads every pass with --top=99]
//        [--pin=<device slot>=<json>: a device slot for every boot, STR16's debug.vertexPack=false]
//
// Writes <out>/<zone>.json (`vertex-census/1`) and prints one line per zone. Resident vertices count each vertex buffer
// once (bytes / stride, a buffer with a position channel and no divisor); a buffer no draw has read yet has no layout and
// is counted in `unlaidBytes`. Counts, not footprint: the shim slows the page, so it never rides a memory reading.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { webkitBoot, openOnlineBoot, devicePin } from './measure.mjs';
import { resolveCameras, parseCameraFile, facing } from '../look-loop/cameras.mjs';

export const PROTOCOL = 'vertex-census/1';

/** Bytes per component of a GL vertex attribute type. @type {Record<number, number>} */
export const TYPE_BYTES = Object.freeze({ 0x1400: 1, 0x1401: 1, 0x1402: 2, 0x1403: 2, 0x1404: 4, 0x1405: 4, 0x1406: 4, 0x140b: 2, 0x8d61: 2, 0x8368: 4, 0x8d9f: 4 });
/** Short names of the GL types. @type {Record<number, string>} */
export const TYPE_NAMES = Object.freeze({ 0x1400: 'i8', 0x1401: 'u8', 0x1402: 'i16', 0x1403: 'u16', 0x1404: 'i32', 0x1405: 'u32', 0x1406: 'f32', 0x140b: 'f16', 0x8d61: 'f16', 0x8368: 'u2_10_10_10', 0x8d9f: 'i2_10_10_10' });

/** Components of a GLSL varying type. @type {Record<string, number>} */
const COMPONENTS = { float: 1, int: 1, uint: 1, bool: 1, vec2: 2, ivec2: 2, uvec2: 2, bvec2: 2, vec3: 3, ivec3: 3, uvec3: 3, bvec3: 3, vec4: 4, ivec4: 4, uvec4: 4, bvec4: 4, mat2: 4, mat3: 9, mat4: 16, mat2x3: 6, mat3x2: 6, mat2x4: 8, mat4x2: 8, mat3x4: 12, mat4x3: 12 };

/** The lines of a GLSL source the preprocessor keeps, with its #defines (object-like only; enough for three.js and the
 * engine's graph shaders: #if / #ifdef / #ifndef / #elif / #else / #endif, `defined(X)`, numeric comparisons).
 * @param {string} source @returns {{lines: string[], defines: Map<string, string>}} */
export function preprocess(source) {
  /** @type {Map<string, string>} */ const defines = new Map();
  /** @type {{active: boolean, taken: boolean, parent: boolean}[]} */ const stack = [];
  const live = () => stack.every((f) => f.active);
  const value = (/** @type {string} */ expr) => {
    let e = expr.replace(/\/\/.*$/u, '').replaceAll(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/gu, (_, a, b) => (defines.has(a ?? b) ? '1' : '0'));
    for (let i = 0; i < 8; i++) {
      const next = e.replaceAll(/\b[A-Za-z_]\w*\b/gu, (id) => (defines.has(id) ? `(${defines.get(id) === '' ? '1' : defines.get(id)})` : '0'));
      if (next === e) break; e = next;
    }
    e = e.replaceAll(/(\d+(?:\.\d+)?)[uUfF]\b/gu, '$1');
    if (!/^[\d\s()+\-*/%<>=!&|.]*$/u.test(e)) return false;
    // oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- e is checked above to hold only digits and operators
    try { return Boolean(new Function(`"use strict"; return (${e});`)()); } catch { return false; }
  };
  const lines = [];
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    const d = /^#\s*(\w+)\s*(.*)$/u.exec(line);
    if (d) {
      const [, word, rest] = d;
      if (word === 'ifdef' || word === 'ifndef' || word === 'if') {
        const parent = live();
        const on = parent && (word === 'ifdef' ? defines.has(rest.trim()) : word === 'ifndef' ? !defines.has(rest.trim()) : value(rest));
        stack.push({ active: on, taken: on, parent });
      } else if (word === 'elif') {
        const top = stack.at(-1); if (!top) continue;
        const on = top.parent && !top.taken && value(rest); top.active = on; top.taken ||= on;
      } else if (word === 'else') {
        const top = stack.at(-1); if (!top) continue;
        top.active = top.parent && !top.taken; top.taken = true;
      } else if (word === 'endif') stack.pop();
      else if (live() && word === 'define') { const m = /^(\w+)(?:\s+(.*))?$/u.exec(rest); if (m && !rest.startsWith(`${m[1]}(`)) defines.set(m[1], (m[2] ?? '').trim()); }
      else if (live() && word === 'undef') defines.delete(rest.trim());
      continue;
    }
    if (live()) lines.push(raw);
  }
  return { lines, defines };
}

/** A shader's stage interface: `varying` / `out` (vertex) or `varying` / `in` (fragment) declarations that survive the
 * preprocessor, by name with their components. Layout-qualified fragment outputs and vertex inputs are not varyings.
 * @param {string} source @param {'vertex'|'fragment'} stage @returns {Map<string, number>} */
export function stageVaryings(source, stage) {
  const { lines, defines } = preprocess(source);
  const keyword = (/** @type {string} */ k) => defines.get(k) ?? k;
  /** @type {Map<string, number>} */ const out = new Map();
  const text = lines.join('\n').replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/\/\/.*$/gmu, '');
  for (const statement of text.split(';')) {
    const words = statement.replaceAll(/\s+/gu, ' ').trim();
    if (words === '' || /\(|\{|\}|=/u.test(words) || /^layout\b/u.test(words)) continue;
    const parts = words.split(' ').map(keyword).join(' ').split(' ').filter(Boolean);
    const qualifier = parts.find((p) => p === 'varying' || p === 'out' || p === 'in');
    if (qualifier === undefined) continue;
    if (stage === 'vertex' && qualifier === 'in') continue;
    if (stage === 'fragment' && qualifier === 'out') continue;
    const rest = parts.slice(parts.indexOf(qualifier) + 1).filter((p) => !/^(highp|mediump|lowp|flat|smooth|centroid|noperspective|invariant)$/u.test(p));
    const type = rest[0], decl = rest.slice(1).join('');
    if (!(type in COMPONENTS)) continue;
    for (const one of decl.split(',')) {
      const m = /^(\w+)(?:\[(\w+)\])?$/u.exec(one);
      if (!m) continue;
      const n = m[2] === undefined ? 1 : Number(/^\d+$/u.test(m[2]) ? m[2] : defines.get(m[2]) ?? 1);
      out.set(m[1], COMPONENTS[type] * (Number.isFinite(n) ? n : 1));
    }
  }
  return out;
}

/** A program's live varyings: vertex outputs the fragment stage declares. @param {string} vertex @param {string} fragment */
export function liveVaryings(vertex, fragment) {
  const vs = stageVaryings(vertex, 'vertex'), fs = stageVaryings(fragment, 'fragment');
  const names = [...vs.keys()].filter((name) => fs.has(name)).sort();
  return { count: names.length, components: names.reduce((sum, name) => sum + (vs.get(name) ?? 0), 0), names, vertexOutputs: vs.size };
}

/** A program's label: three's SHADER_NAME, else the engine graph's first `// ` title line, else its id. @param {string} vertex @param {number} id */
export function programName(vertex, id) {
  const named = /#define SHADER_NAME\s+(.+)/u.exec(vertex)?.[1]?.trim();
  if (named) return named;
  const type = /#define SHADER_TYPE\s+(\S+)/u.exec(vertex)?.[1];
  if (type) return `three:${type}`;
  const title = /^\s*\/\/\s*(\S.{0,60})$/mu.exec(vertex)?.[1]?.trim();
  return title ? `${title} #${id}` : `program #${id}`;
}

/** The page's WebGL 2 shim (an init script): every buffer's bytes, each VAO's attribute pointers, every program's text,
 * and on request one frame's draws. `window.__vertexCensus.frame()` resolves with that frame; `.resident()` with every
 * buffer and its layout. */
export const SHIM = String.raw`(() => {
  if (typeof WebGL2RenderingContext !== 'function') return;
  const P = WebGL2RenderingContext.prototype, ARRAY = 0x8892, ELEMENT = 0x8893;
  let ids = 0; const idOf = new WeakMap(); const id = (o) => { if (!o) return 0; let v = idOf.get(o); if (!v) { v = ++ids; idOf.set(o, v); } return v; };
  const buffers = new Map(); // buffer -> {id, bytes, target, layout: Map key -> attr, programs: Set}
  const shaders = new WeakMap(); // shader -> {type, source}
  const programs = new Map(); // program -> {id, vs, fs, attribs: Map loc -> name | null}
  const vaos = new Map(); // vao or 'default' -> {attribs: Map loc -> pointer, element}
  const ctxs = new WeakMap();
  const stateOf = (gl) => { let s = ctxs.get(gl); if (!s) { s = { array: null, vao: 'default', program: null }; ctxs.set(gl, s); } return s; };
  const vaoOf = (gl) => { const key = stateOf(gl).vao ?? 'default'; let v = vaos.get(key); if (!v) { v = { attribs: new Map(), element: null, dirty: true }; vaos.set(key, v); } return v; };
  const wrap = (name, after) => { const f = P[name]; if (typeof f !== 'function') return; P[name] = function (...a) { const r = f.apply(this, a); try { after.call(this, a, r); } catch {} return r; }; };
  wrap('bindBuffer', function ([target, buffer]) { const st = stateOf(this); st.bound ??= new Map(); if (target === ARRAY) st.array = buffer; else if (target === ELEMENT) vaoOf(this).element = buffer; else st.bound.set(target, buffer); if (buffer && !buffers.has(buffer)) buffers.set(buffer, { id: id(buffer), bytes: 0, target, layout: new Map(), programs: new Set() }); });
  wrap('bufferData', function ([target, data, usage, srcOffset, length]) {
    const buffer = target === ARRAY ? stateOf(this).array : target === ELEMENT ? vaoOf(this).element : stateOf(this).bound?.get(target);
    const row = buffer && buffers.get(buffer); if (!row) return;
    let bytes = 0;
    if (typeof data === 'number') bytes = data;
    else if (ArrayBuffer.isView(data)) { const per = data.BYTES_PER_ELEMENT ?? 1; bytes = length ? length * per : data.byteLength - (srcOffset ?? 0) * per; }
    else if (data && typeof data.byteLength === 'number') bytes = data.byteLength;
    row.bytes = bytes; row.target = target; row.indices = target === ELEMENT ? (ArrayBuffer.isView(data) ? bytes / (data.BYTES_PER_ELEMENT ?? 1) : bytes / 2) : 0;
  });
  wrap('deleteBuffer', function ([buffer]) { buffers.delete(buffer); });
  wrap('bindVertexArray', function ([vao]) { stateOf(this).vao = vao ?? 'default'; });
  wrap('deleteVertexArray', function ([vao]) { vaos.delete(vao); });
  const pointer = function (loc, size, type, normalized, stride, offset, int) { const v = vaoOf(this); const old = v.attribs.get(loc); v.attribs.set(loc, { buffer: stateOf(this).array, size, type, normalized: Boolean(normalized), stride, offset, int, divisor: old?.divisor ?? 0 }); v.dirty = true; };
  wrap('vertexAttribPointer', function ([loc, size, type, normalized, stride, offset]) { pointer.call(this, loc, size, type, normalized, stride, offset, false); });
  wrap('vertexAttribIPointer', function ([loc, size, type, stride, offset]) { pointer.call(this, loc, size, type, false, stride, offset, true); });
  wrap('vertexAttribDivisor', function ([loc, divisor]) { const v = vaoOf(this); const a = v.attribs.get(loc); if (a) a.divisor = divisor; else v.attribs.set(loc, { divisor }); v.dirty = true; });
  wrap('createShader', function ([type], shader) { if (shader) shaders.set(shader, { type, source: '' }); });
  wrap('shaderSource', function ([shader, source]) { const s = shaders.get(shader); if (s) s.source = source; });
  wrap('attachShader', function ([program, shader]) { let p = programs.get(program); if (!p) { p = { id: id(program), vs: '', fs: '', attribs: null }; programs.set(program, p); } const s = shaders.get(shader); if (s) { if (s.type === 0x8b31) p.vs = s.source; else p.fs = s.source; } });
  wrap('linkProgram', function ([program]) { const p = programs.get(program); if (p) p.attribs = null; });
  wrap('deleteProgram', function ([program]) { programs.delete(program); });
  wrap('useProgram', function ([program]) { stateOf(this).program = program; });
  const attribNames = (gl, program) => {
    const p = programs.get(program); if (!p) return null;
    if (!p.attribs) { p.attribs = new Map(); const n = gl.getProgramParameter(program, 0x8b89) ?? 0; for (let i = 0; i < n; i++) { const info = gl.getActiveAttrib(program, i); if (info) p.attribs.set(gl.getAttribLocation(program, info.name), info.name); } }
    return p;
  };
  // the layout a draw reads, kept on each buffer (named by the program's attributes)
  const seen = new Set();
  const learn = (gl) => {
    const s = stateOf(gl), v = vaoOf(gl), program = s.program; if (!program) return null;
    const p = attribNames(gl, program); if (!p) return null;
    const key = id(s.vao === 'default' ? null : s.vao) + ':' + p.id;
    if (!v.dirty && seen.has(key)) return p;
    seen.add(key); v.dirty = false;
    for (const [loc, name] of p.attribs) {
      const a = v.attribs.get(loc); if (!a || !a.buffer) continue;
      const row = buffers.get(a.buffer); if (!row) continue;
      row.layout.set(name + '@' + a.offset, { name, size: a.size, type: a.type, normalized: a.normalized, int: a.int, stride: a.stride, offset: a.offset, divisor: a.divisor });
      row.programs.add(p.id);
    }
    if (v.element) { const row = buffers.get(v.element); if (row) row.programs.add(p.id); }
    return p;
  };
  let frame = null;
  const tris = (mode, count) => (mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0);
  const draw = (gl, mode, count, instances) => {
    const p = learn(gl);
    if (!frame || !p) return;
    frame.draws++; frame.triangles += tris(mode, count) * instances; frame.vertices += count * instances;
    const row = frame.programs.get(p.id) ?? { draws: 0, invocations: 0, triangles: 0 };
    row.draws++; row.invocations += count * instances; row.triangles += tris(mode, count) * instances; frame.programs.set(p.id, row);
  };
  wrap('drawArrays', function ([mode, first, count]) { draw(this, mode, count, 1); });
  wrap('drawElements', function ([mode, count]) { draw(this, mode, count, 1); });
  wrap('drawRangeElements', function ([mode, start, end, count]) { draw(this, mode, count, 1); });
  wrap('drawArraysInstanced', function ([mode, first, count, n]) { draw(this, mode, count, n); });
  wrap('drawElementsInstanced', function ([mode, count, type, offset, n]) { draw(this, mode, count, n); });
  const multi = new WeakSet();
  const getExtension = P.getExtension;
  P.getExtension = function (name) {
    const ext = getExtension.call(this, name); const gl = this;
    if (ext && /multi_draw/i.test(name) && !multi.has(ext)) {
      multi.add(ext);
      const w = (fn, body) => { const f = ext[fn]; if (typeof f !== 'function') return; ext[fn] = function (...a) { const r = f.apply(this, a); try { body(a); } catch {} return r; }; };
      w('multiDrawElementsWEBGL', ([mode, counts, co, type, offs, oo, n]) => { for (let i = 0; i < n; i++) draw(gl, mode, counts[co + i], 1); });
      w('multiDrawElementsInstancedWEBGL', ([mode, counts, co, type, offs, oo, inst, io, n]) => { for (let i = 0; i < n; i++) draw(gl, mode, counts[co + i], inst[io + i]); });
      w('multiDrawArraysWEBGL', ([mode, firsts, fo, counts, co, n]) => { for (let i = 0; i < n; i++) draw(gl, mode, counts[co + i], 1); });
      w('multiDrawArraysInstancedWEBGL', ([mode, firsts, fo, counts, co, inst, io, n]) => { for (let i = 0; i < n; i++) draw(gl, mode, counts[co + i], inst[io + i]); });
      w('multiDrawElementsInstancedBaseVertexBaseInstanceWEBGL', ([mode, counts, co, type, offs, oo, inst, io, bv, bvo, bi, bio, n]) => { for (let i = 0; i < n; i++) draw(gl, mode, counts[co + i], inst[io + i]); });
    }
    return ext;
  };
  const programRows = () => [...programs.values()].map((p) => ({ id: p.id, vs: p.vs, fs: p.fs }));
  window.__vertexCensus = {
    frame: () => new Promise((resolve) => {
      requestAnimationFrame(() => {
        frame = { draws: 0, triangles: 0, vertices: 0, programs: new Map() };
        requestAnimationFrame(() => {
          const f = frame; frame = null;
          const info = window.__wildshard?.world?.game?.lastFrame;
          resolve({ draws: f.draws, triangles: f.triangles, vertices: f.vertices, three: info ? { calls: info.calls, triangles: info.triangles } : null, programs: [...f.programs].map(([pid, r]) => ({ id: pid, ...r })) });
        });
      });
    }),
    resident: () => [...buffers.values()].map((b) => ({ id: b.id, bytes: b.bytes, target: b.target, indices: b.indices ?? 0, layout: [...b.layout.values()], programs: [...b.programs] })),
    programs: programRows,
  };
})();`;

/** In the page: the look loop's pose hook (views.mjs installPose): a god pose is set last in every frame. */
function installPose() {
  const w = /** @type {any} */ (window).__wildshard.world;
  if (w.animals) w.animals.calm = true;
  if (/** @type {any} */ (window).__lookLoop) return;
  /** @type {any} */ (window).__lookLoop = { pose: null };
  w.game.onLate(() => {
    const p = /** @type {any} */ (window).__lookLoop.pose, cam = w.game.camera;
    if (!p) return;
    for (const ch of cam.children) ch.visible = false;
    cam.position.set(p.pos[0], p.pos[1], p.pos[2]);
    if (p.up) cam.up.set(p.up[0], p.up[1], p.up[2]); else cam.up.set(0, 1, 0);
    cam.lookAt(p.look[0], p.look[1], p.look[2]); cam.up.set(0, 1, 0);
    cam.updateMatrixWorld(true);
    if (Math.abs(cam.fov - p.fovV) > 0.01) { cam.fov = p.fovV; cam.updateProjectionMatrix(); }
  }, 'vertex-census.pose');
}

/** In the page: one camera (views.mjs poseCamera, without the animal parking). @param {any} c */
async function poseCamera(c) {
  const w = /** @type {any} */ (window).__wildshard.world, probe = /** @type {any} */ (window).__wildshard;
  if (c.mode === 'god') { await probe.pose({ x: c.look[0], z: c.look[2] }); w.freeCamera = true; /** @type {any} */ (window).__lookLoop.pose = c; return; }
  /** @type {any} */ (window).__lookLoop.pose = null; w.freeCamera = false;
  for (const ch of w.game.camera.children) ch.visible = true;
  await probe.pose({ x: c.x, z: c.z, yaw: c.yaw, pitch: c.pitch });
}

/** The census of one boot's buffers: resident vertices and bytes by channel, split by the program family that reads them.
 * @param {{id:number, bytes:number, target:number, indices?:number, layout:{name:string,size:number,type:number,normalized:boolean,int:boolean,stride:number,offset:number,divisor:number}[], programs:number[]}[]} buffers
 * @param {Map<number, string>} names program id -> name */
export function residentCensus(buffers, names) {
  const out = { triangles: 0, arrayBytes: 0, elementBytes: 0, otherBytes: 0, instanceBytes: 0, unlaidBytes: 0, vertexBytes: 0, vertices: 0,
    /** @type {Record<string, {bytes:number, perVertex:Record<string, number>}>} */ channels: {},
    /** @type {Record<string, {bytes:number, vertices:number, vertexBytes:number, channels:Record<string, string>}>} */ families: {} };
  for (const b of buffers) {
    if (b.bytes <= 0) continue;
    if (b.target === 0x8893) { out.elementBytes += b.bytes; out.triangles += Math.floor((b.indices ?? 0) / 3); continue; }
    if (b.target !== 0x8892) { out.otherBytes += b.bytes; continue; }
    out.arrayBytes += b.bytes;
    if (b.layout.length === 0) { out.unlaidBytes += b.bytes; continue; }
    if (b.layout.some((a) => a.divisor > 0)) { out.instanceBytes += b.bytes; continue; }
    const stride = b.layout[0].stride || (TYPE_BYTES[b.layout[0].type] ?? 4) * b.layout[0].size;
    const count = Math.floor(b.bytes / stride);
    const hasPosition = b.layout.some((a) => /position/iu.test(a.name));
    const family = familyOf(b.programs.map((pid) => names.get(pid) ?? `#${pid}`));
    const f = (out.families[family] ??= { bytes: 0, vertices: 0, vertexBytes: 0, channels: {} });
    f.bytes += b.bytes; out.vertexBytes += b.bytes;
    if (hasPosition) { out.vertices += count; f.vertices += count; }
    for (const a of b.layout) {
      const each = (TYPE_BYTES[a.type] ?? 4) * a.size;
      const c = (out.channels[a.name] ??= { bytes: 0, perVertex: {} });
      c.bytes += each * count;
      const shape = `${TYPE_NAMES[a.type] ?? a.type}x${a.size}${a.normalized ? 'n' : ''}`;
      c.perVertex[shape] = (c.perVertex[shape] ?? 0) + count;
      f.channels[a.name] = shape;
    }
  }
  for (const f of Object.values(out.families)) f.vertexBytes = f.vertices > 0 ? Math.round((f.bytes / f.vertices) * 10) / 10 : 0;
  return out;
}

/** A program family from the names of the programs that read a buffer: slab, instanced, skinned, terrain, sky, water, ... */
export function familyOf(/** @type {readonly string[]} */ names) {
  const all = names.join(' ').toLowerCase();
  for (const [family, re] of /** @type {[string, RegExp][]} */ ([['slab', /slab/u], ['terrain', /terrain|ground|heightfield/u], ['water', /water|ocean|sea/u],
    ['sky', /sky|cloud|star/u], ['foliage', /grass|foliage|leaf|tree|bush/u], ['skinned', /skin|character|avatar/u], ['particles', /particle|spark|rain|snow|vfx/u]])) if (re.test(all)) return family;
  return names.length === 0 ? 'unread' : names[0].replace(/\s*#\d+$/u, '');
}

/** One frame's heaviest passes by vertex invocations times (varying components + gl_Position's 4).
 * @param {{programs:{id:number, draws:number, invocations:number, triangles:number}[]}} frame
 * @param {Map<number, {name:string, varyings:ReturnType<typeof liveVaryings>}>} info */
export function heaviestPasses(frame, info, top = 3) {
  return frame.programs.map((r) => {
    const p = info.get(r.id); const comps = (p?.varyings.components ?? 0) + 4;
    return { ...r, name: p?.name ?? `#${r.id}`, varyings: p?.varyings.count ?? null, components: p?.varyings.components ?? null, weight: r.invocations * comps };
  }).sort((a, b) => b.weight - a.weight).slice(0, top);
}

/** @param {any} page @param {{settleMs:number}} o */
async function censusAtControl(page, o) {
  const spawn = await page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player; return { x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw }; });
  const control = await page.evaluate(() => /** @type {any} */ (window).__vertexCensus.resident());
  const def = parseCameraFile({ fp: { viewport: [402, 874] }, god: { viewport: [402, 874], tier: 'phone' }, anchors: [{ id: 'spawn', P: { x: 0, z: 0 }, faceTo: { x: 0, z: -1 } }] });
  const [fx, fz] = facing(spawn.yaw), r = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;
  const P = { x: r(spawn.x), z: r(spawn.z) };
  const cameras = resolveCameras(def, { P, faceTo: { x: P.x + fx * 10, z: P.z + fz * 10 } }, spawn.y);
  await page.evaluate(installPose);
  await sleep(o.settleMs);
  const frames = [];
  for (const c of cameras) {
    await page.evaluate(poseCamera, c);
    await sleep(o.settleMs);
    frames.push({ n: c.n, id: c.id, ...(await page.evaluate(() => /** @type {any} */ (window).__vertexCensus.frame())) });
  }
  const resident = await page.evaluate(() => /** @type {any} */ (window).__vertexCensus.resident());
  const programs = await page.evaluate(() => /** @type {any} */ (window).__vertexCensus.programs());
  return { spawn, frames, control, resident, programs };
}

const mb = (/** @type {number | null | undefined} */ b) => (b === null || b === undefined ? '-' : (b / 1e6).toFixed(1));

/** @param {string[]} argv */
async function main(argv) {
  const args = Object.fromEntries(argv.map((a) => /^--([^=]+)(?:=(.*))?$/u.exec(a)).filter((m) => m !== null).map((m) => [m[1], m[2] ?? '1']));
  if ((!args.dist && !args.url) || !args.zones) { console.error('usage: vertex-census.mjs --dist=<built client folder> | --url=<served client>, --zones=a,b|all [--out=<dir>] [--settle=3]'); return 64; }
  const catalogue = args.dist ? JSON.parse(readFileSync(join(args.dist, 'catalogue.json'), 'utf8')) : null;
  const zones = args.zones === 'all' ? [...new Set((catalogue?.grid?.cells ?? []).map((/** @type {any} */ c) => c.slug))].sort((a, b) => a.localeCompare(b)) : args.zones.split(',');
  const out = resolvePath(args.out ?? 'tmp/vertex-census'); mkdirSync(out, { recursive: true });
  const settleMs = Number(args.settle ?? 3) * 1000;
  const { harnessPins, saveFixture } = await import('../debug-settings.mjs');
  // STR16: `--pin=<device slot>=<json>` boots every zone under that device slot (debug.vertexPack=false: the unpacked census)
  const pin = args.pin ? devicePin(args.pin) : null;
  let failed = 0;
  for (const zone of zones) {
    const world = args.dist ? await openOnlineBoot({ dist: args.dist, chunk: zone, scratch: join(out, 'online') }) : null;
    try {
      const base = world?.url ?? args.url, url = args.query ? `${base}${base.includes('?') ? '&' : '?'}${args.query}` : base;
      const run = await webkitBoot({ url, chunk: zone, world: world?.stamp ?? null, timeoutMs: 240_000,
        prepare: async (/** @type {any} */ context) => { await harnessPins(context, { seed: 357 }); await context.addInitScript(SHIM); if (pin) await saveFixture(context, { scope: 'device', ...pin }); },
        probe: (/** @type {any} */ page) => censusAtControl(page, { settleMs }) });
      const probed = /** @type {any} */ (run.probe);
      if (!run.ready || !probed) { failed++; console.log(`${zone}: no census (${run.failure ?? run.refused ?? 'no probe'})`); continue; }
      /** @type {Map<number, {name:string, varyings:ReturnType<typeof liveVaryings>}>} */
      const info = new Map(probed.programs.map((/** @type {any} */ p) => [p.id, { name: programName(p.vs, p.id), varyings: liveVaryings(p.vs, p.fs) }]));
      const names = new Map([...info].map(([pid, p]) => [pid, p.name]));
      const resident = residentCensus(probed.resident, names);
      const controlResident = residentCensus(probed.control, names);
      const frames = probed.frames.map((/** @type {any} */ f) => ({ n: f.n, id: f.id, draws: f.draws, triangles: f.triangles, vertices: f.vertices, three: f.three, heaviest: heaviestPasses(f, info, Number(args.top ?? 3)) }));
      const glBuffers = run.ledger?.byKind?.gpu?.buffer ?? null;
      const row = { protocol: PROTOCOL, zone, query: args.query ?? null, boot: run.boot, build: run.build, date: new Date().toISOString(), spawn: probed.spawn, ledgerGpu: run.ledger?.byKind?.gpu ?? null, glBuffers, controlResident, resident, frames };
      writeFileSync(join(out, `${zone}.json`), `${JSON.stringify(row, null, 1)}\n`);
      const fp = frames.filter((/** @type {any} */ f) => f.n <= 4), max = Math.max(...frames.map((/** @type {any} */ f) => f.triangles));
      const top = frames.flatMap((/** @type {any} */ f) => f.heaviest).sort((a, b) => b.weight - a.weight)[0];
      console.log(`${zone}: boot ${run.boot}, GL buffers ${mb(glBuffers)} MB [L], vertex buffers ${mb(resident.vertexBytes)} MB, ${(resident.vertices / 1e6).toFixed(2)} M vertices`
        + ` (${resident.vertices > 0 ? (resident.vertexBytes / resident.vertices).toFixed(1) : '-'} B/v), index ${mb(resident.elementBytes)} MB, instance ${mb(resident.instanceBytes)} MB, unlaid ${mb(resident.unlaidBytes)} MB;`
        + ` tris/frame FP mean ${(fp.reduce((s, f) => s + f.triangles, 0) / Math.max(1, fp.length) / 1e3).toFixed(0)} k, max of nine ${(max / 1e3).toFixed(0)} k;`
        + ` heaviest pass ${top?.name ?? '-'} (${top?.varyings ?? '-'} varyings, ${top?.components ?? '-'} comps, ${top ? (top.invocations / 1e6).toFixed(2) : '-'} M invocations)`);
    } catch (error) { failed++; console.log(`${zone}: census failed: ${/** @type {Error} */ (error).message.split('\n')[0]}`); }
    finally { await world?.close(); }
  }
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolvePath(process.argv[1]) === import.meta.filename) process.exitCode = await main(process.argv.slice(2));
