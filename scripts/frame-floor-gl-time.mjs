import { PROGRAM_NAMES_SCRIPT } from './frame-floor-programs.mjs';

/** Diagnostic wall time only: no extra GL queries, synchronization or readback. */
export const GL_TIMED = [
  'texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D',
  'compressedTexImage2D', 'compressedTexSubImage2D', 'compressedTexImage3D', 'compressedTexSubImage3D',
  'texStorage2D', 'texStorage3D', 'copyTexImage2D', 'copyTexSubImage2D', 'copyTexSubImage3D', 'generateMipmap',
  'compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'getShaderInfoLog',
  'getUniformLocation', 'getUniformBlockIndex', 'uniformBlockBinding', 'bindBufferBase', 'getActiveUniform', 'getActiveAttrib',
  'bufferData', 'bufferSubData', 'readPixels', 'getBufferSubData', 'getError', 'getParameter', 'checkFramebufferStatus',
  'finish', 'clientWaitSync', 'fenceSync', 'waitSync', 'getSyncParameter', 'flush',
  'drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'clear', 'blitFramebuffer', 'invalidateFramebuffer',
];

/** @param {readonly string[]} methods */
function installGlTiming(methods) {
  const W = window;
  if (typeof W.__frameFloorGlTake === 'function') return;
  const acc = new Map(), uploads = new Map();
  W.__frameFloorGlTake = () => {
    if (acc.size === 0) return null;
    const out = {};
    for (const [key, value] of acc) out[key] = [Math.round(value[0] * 10) / 10, value[1]];
    acc.clear(); return out;
  };
  // These are attempted source spans, not GPU residency or GPU-process execution time. Image sources carry pixels,
  // not invented RGBA bytes. PBO offsets/other unknown sources stay explicitly unknown; no binding queries are issued.
  W.__frameFloorGlUploadsTake = () => {
    if (uploads.size === 0) return null;
    const out = {};
    for (const [key, value] of uploads) out[key] = { ...value };
    uploads.clear(); return out;
  };
  const upload = (method, args) => {
    let row = uploads.get(method);
    if (row === undefined) {
      row = { calls: 0, sourceBytes: 0, allocationBytes: 0, imagePixels: 0, unknownCalls: 0 };
      uploads.set(method, row);
    }
    row.calls++;
    try {
      const buffer = method === 'bufferData' || method === 'bufferSubData';
      const compressed = method.startsWith('compressed');
      const index = buffer ? method === 'bufferData' ? 1 : 2
        : method === 'texImage2D' ? args.length === 6 ? 5 : 8
        : method === 'texSubImage2D' ? args.length === 7 ? 6 : 8
        : method === 'texImage3D' ? 9 : method === 'texSubImage3D' ? 10
        : method === 'compressedTexImage2D' ? 6 : method === 'compressedTexSubImage2D' ? 7
        : method === 'compressedTexImage3D' ? 7 : 9;
      const source = args[index];
      if (method === 'bufferData' && typeof source === 'number' && Number.isSafeInteger(source) && source >= 0) {
        row.allocationBytes += source; return;
      }
      if (source === null) return;
      const view = ArrayBuffer.isView(source);
      if (view || source instanceof ArrayBuffer || typeof SharedArrayBuffer === 'function' && source instanceof SharedArrayBuffer) {
        const unit = view ? source.BYTES_PER_ELEMENT ?? 1 : 1;
        const offset = buffer ? args[3] ?? 0 : args[index + 1] ?? 0;
        const length = buffer ? args[4] ?? 0 : compressed ? args[index + 2] ?? 0 : 0;
        const available = source.byteLength - offset * unit, bytes = length === 0 ? available : length * unit;
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > available) row.unknownCalls++;
        else row.sourceBytes += bytes;
        return;
      }
      const width = source?.videoWidth ?? source?.naturalWidth ?? source?.width;
      const height = source?.videoHeight ?? source?.naturalHeight ?? source?.height;
      if (!buffer && !compressed && Number.isSafeInteger(width) && width >= 0 && Number.isSafeInteger(height) && height >= 0) row.imagePixels += width * height;
      else row.unknownCalls++;
    } catch { row.unknownCalls++; }
  };
  for (const Context of [W.WebGLRenderingContext, W.WebGL2RenderingContext]) {
    if (!Context) continue;
    const prototype = Context.prototype;
    for (const method of methods) {
      const original = prototype[method];
      if (typeof original !== 'function' || original.__ffTimed) continue;
      const image = /^tex(Sub)?Image[23]D$/.test(method);
      const transfers = image || method.startsWith('compressedTex') || method === 'bufferData' || method === 'bufferSubData';
      const wrapped = function wrapped(...args) {
        const start = performance.now();
        try { return original.apply(this, args); }
        finally {
          const elapsed = performance.now() - start, prior = acc.get(method);
          if (prior) { prior[0] += elapsed; prior[1]++; } else acc.set(method, [elapsed, 1]);
          if (transfers) upload(method, args);
          if (elapsed >= 3 && /^(?:getProgram|getUniformBlockIndex)/.test(method)) {
            const key = `slow ${method} ${W.__frameFloorProgramName(args[0])}`, value = acc.get(key);
            if (value) { value[0] += elapsed; value[1]++; } else acc.set(key, [elapsed, 1]);
          }
          if (image && elapsed >= 3) {
            const source = args[args.length - 1], size = source && typeof source === 'object'
              ? `${source.naturalWidth ?? source.width ?? source.byteLength ?? 0}x${source.naturalHeight ?? source.height ?? 0}` : 'null';
            const key = `slow ${method} ${source?.constructor?.name ?? '?'} ${size}`, value = acc.get(key);
            if (value) { value[0] += elapsed; value[1]++; } else acc.set(key, [elapsed, 1]);
          }
        }
      };
      wrapped.__ffTimed = true; prototype[method] = wrapped;
    }
  }
}

/** Preboot initializer used exclusively with --gl-time. Scalar banks drain together at each whole-drive sample. */
export const GL_TIMING_SCRIPT = `${PROGRAM_NAMES_SCRIPT}(${installGlTiming.toString()})(${JSON.stringify(GL_TIMED)});`;
