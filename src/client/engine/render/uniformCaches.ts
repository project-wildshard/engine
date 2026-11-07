/**
 * Keeps three's float uniform caches unboxed (D180, the idle page's heap churn). Each uniform remembers the last value it
 * uploaded in a plain `cache` array, all made by one array literal in three; V8 shares one elements kind across that
 * literal's arrays, so once any cache held a non-number (a boolean uniform, a texture unit) every new cache started
 * generic, and each changed matrix or vector element stored afterwards boxed a fresh number: three's setters were the
 * largest per-frame allocators on an idle Template (~0.2 MiB/s, Chromium, `f542b13d37`). A float uniform's cache is
 * swapped, on its program's first `getUniforms`, for an empty array of double elements made by a builtin copy (no
 * allocation-site feedback). Values and skip comparisons stay unchanged. Numeric scalar/vec3 uploads use reusable
 * float32 buffers while retaining unrounded comparison values; other inputs use Three's original setters.
 */
/** FLOAT, FLOAT_VEC2/3/4, FLOAT_MAT2/3/4: the setters that store doubles in their cache */
const FLOAT_TYPES = new Set([0x1406, 0x8b50, 0x8b51, 0x8b52, 0x8b5a, 0x8b5b, 0x8b5c]);
const SEED = [0.5];
/** an empty array of double elements; `slice` copies the seed's kind and records no allocation site */
function doubleArray(): number[] { const array = SEED.slice(); array.length = 0; return array; }

interface Vector3Uniform { cache: number[] | Float64Array; addr: WebGLUniformLocation | null; setValue: (gl: WebGLRenderingContext, value: Vector3Value) => void }
/** A numeric scalar uses the same native float32 payload without boxing a
 * changing argument at every WebGL call. Other values retain native coercion. */
function bufferScalar(node: object, legacy: number[]): void {
  const native: unknown = Reflect.get(node, 'setValue');
  if (typeof native !== 'function') return;
  interface ScalarUniform { cache: unknown[] | Float64Array; addr: WebGLUniformLocation | null }
  const setNative = native as (this: ScalarUniform, gl: WebGLRenderingContext, value: unknown) => void;
  const buffer = new Float32Array(1), numbers = new Float64Array(1);
  Reflect.set(node, 'setValue', function setFloat(this: ScalarUniform, gl: WebGLRenderingContext, value: unknown): void {
    const cache = this.cache;
    if (typeof value !== 'number' || (cache.length > 0 && cache.length !== 1)) {
      if (cache === numbers) { legacy[0] = numbers[0] ?? 0; this.cache = legacy; }
      setNative.call(this, gl, value); return;
    }
    if (cache[0] === value) return;
    buffer[0] = value; gl.uniform1fv(this.addr, buffer);
    numbers[0] = value; this.cache = numbers;
  });
}
interface Vector3Value { x?: number; y?: number; z?: number; r?: number; g?: number; b?: number }
interface Vector3State {
  legacy: number[]; buffer: Float32Array; numbers: Float64Array;
  native: (this: Vector3Uniform, gl: WebGLRenderingContext, value: Vector3Value) => void;
}
function nativeVectorValue(state: Vector3State, uniform: Vector3Uniform, gl: WebGLRenderingContext, value: Vector3Value): void {
  if (uniform.cache === state.numbers) {
    state.legacy[0] = state.numbers[0] ?? 0; state.legacy[1] = state.numbers[1] ?? 0; state.legacy[2] = state.numbers[2] ?? 0;
    uniform.cache = state.legacy;
  }
  state.native.call(uniform, gl, value);
}
// Read numeric components where they are consumed, rather than forwarding
// three boxed doubles through a generic call for every changed uniform.
function xyzVectorValue(state: Vector3State, uniform: Vector3Uniform, gl: WebGLRenderingContext, value: Vector3Value): void {
  const x = value.x, y = value.y, z = value.z;
  const cache = uniform.cache;
  if (typeof y !== 'number' || typeof z !== 'number' || (cache.length > 0 && cache.length !== 3)) {
    nativeVectorValue(state, uniform, gl, value); return;
  }
  if (cache[0] === x && cache[1] === y && cache[2] === z) return;
  const buffer = state.buffer;
  // A changing getter can return undefined on its second read. Match the
  // typed store's NaN conversion; null, if supplied natively, still means 0.
  // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- null must retain native typed-store coercion
  buffer[0] = x === undefined ? Number.NaN : x; buffer[1] = y; buffer[2] = z;
  gl.uniform3fv(uniform.addr, buffer);
  const numbers = state.numbers;
  // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- null must retain native typed-store coercion
  numbers[0] = x === undefined ? Number.NaN : x; numbers[1] = y; numbers[2] = z; uniform.cache = numbers;
}
function colorVectorValue(state: Vector3State, uniform: Vector3Uniform, gl: WebGLRenderingContext, value: Vector3Value): void {
  if (value.r === undefined) { nativeVectorValue(state, uniform, gl, value); return; }
  const x = value.r, y = value.g, z = value.b, cache = uniform.cache;
  if (typeof y !== 'number' || typeof z !== 'number' || (cache.length > 0 && cache.length !== 3)) {
    nativeVectorValue(state, uniform, gl, value); return;
  }
  if (cache[0] === x && cache[1] === y && cache[2] === z) return;
  const buffer = state.buffer;
  buffer[0] = x; buffer[1] = y; buffer[2] = z;
  gl.uniform3fv(uniform.addr, buffer);
  const numbers = state.numbers;
  numbers[0] = x; numbers[1] = y; numbers[2] = z; uniform.cache = numbers;
}
/** WebGL converts each scalar argument to float32. Keep that exact payload in
 * one per-uniform buffer instead of boxing three changing native arguments.
 * Array inputs retain Three's own validation, length and cache behavior. */
function bufferVector3(node: object, legacy: number[]): void {
  const native: unknown = Reflect.get(node, 'setValue');
  if (typeof native !== 'function') return;
  // Float64 cache stores cannot widen through native helpers shared with
  // integer/boolean uniforms. Restore the native array only when an
  // array (including malformed lengths) actually reaches the original setter.
  const state: Vector3State = { legacy, buffer: new Float32Array(3), numbers: new Float64Array(3),
    native: native as Vector3State['native'] };
  // Each native binding calls its current value-kind setter directly. Kind
  // changes replace only this binding's setter; neither path allocates a frame.
  function setXYZ(this: Vector3Uniform, gl: WebGLRenderingContext, value: Vector3Value): void {
    if (value.x !== undefined) xyzVectorValue(state, this, gl, value);
    else { this.setValue = setRGB; colorVectorValue(state, this, gl, value); }
  }
  function setRGB(this: Vector3Uniform, gl: WebGLRenderingContext, value: Vector3Value): void {
    if (value.x !== undefined) { this.setValue = setXYZ; xyzVectorValue(state, this, gl, value); }
    else colorVectorValue(state, this, gl, value);
  }
  Reflect.set(node, 'setValue', setRGB);
}

/** swap each float leaf's cache under a program's uniform tree (structured uniforms nest in `seq`) */
function rekind(node: unknown): void {
  if (typeof node !== 'object' || node === null) return;
  const seq: unknown = Reflect.get(node, 'seq');
  if (Array.isArray(seq)) { for (const child of seq as readonly unknown[]) rekind(child); return; }
  const cache: unknown = Reflect.get(node, 'cache'), type: unknown = Reflect.get(node, 'type');
  if (!Array.isArray(cache) || typeof type !== 'number' || !FLOAT_TYPES.has(type)) return;
  const fresh = doubleArray();
  for (const value of cache as readonly unknown[]) { if (typeof value !== 'number') return; fresh.push(value); }
  Reflect.set(node, 'cache', fresh);
  // PureArrayUniform has the same GL type but owns flattening and array length.
  if (type === 0x8b51 && Reflect.get(node, 'size') === undefined) bufferVector3(node, fresh);
  else if (type === 0x1406 && Reflect.get(node, 'size') === undefined) bufferScalar(node, fresh);
}

/** wrap one new program's `getUniforms`: its first call (three's own first use) builds the tree, then swaps the caches and
 *  puts the original method back, so later draws call three's method directly */
function watch(program: unknown): void {
  if (typeof program !== 'object' || program === null) return;
  const own: unknown = Reflect.get(program, 'getUniforms');
  if (typeof own !== 'function') return;
  Reflect.set(program, 'getUniforms', function getUniforms(this: unknown): unknown {
    const uniforms: unknown = Reflect.apply(own, this, []);
    Reflect.set(program, 'getUniforms', own);
    rekind(uniforms);
    return uniforms;
  });
}

/** Watch every program the renderer acquires from now on (its program list's `push`, once per new program). */
export function installUniformCacheKinds(renderer: { readonly info: { readonly programs: readonly unknown[] | null } }): void {
  const programs: unknown = renderer.info.programs;
  if (!Array.isArray(programs)) return;
  const list: unknown[] = programs, push = list.push.bind(list);
  for (const program of list) watch(program);
  // an own, non-enumerable push: the list still reads and spreads as three's plain array
  Object.defineProperty(list, 'push', { configurable: true, writable: true, enumerable: false,
    value: (...items: unknown[]): number => { for (const item of items) watch(item); return push(...items); } });
}
