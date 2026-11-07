import * as THREE from 'three';

/**
 * A CPU reference evaluator for the small arithmetic GLSL subset the classic graph emitter writes for maths-only
 * graphs (`float t0 = …; vec3 t1 = …;`): + − × ÷, unary minus, swizzles, vector constructors and the built-ins below.
 * Tests run an emitted stage body against its live uniforms and compare the result with the engine's own CPU maths
 * (windField, waves), the oracle the TSL node evaluators used to be (NF18). Anything outside the subset throws.
 */
export type GlslValue = readonly number[];

const BUILTINS: Readonly<Record<string, (args: readonly GlslValue[]) => GlslValue>> = {
  sin: ([a]) => map(a, Math.sin), cos: ([a]) => map(a, Math.cos), abs: ([a]) => map(a, Math.abs), floor: ([a]) => map(a, Math.floor),
  sqrt: ([a]) => map(a, Math.sqrt), fract: ([a]) => map(a, x => x - Math.floor(x)),
  length: ([a]) => [Math.hypot(...need(a))],
  normalize: ([a]) => { const v = need(a), l = Math.hypot(...v); return v.map(x => x / l); },
  dot: ([a, b]) => [zip(need(a), need(b), (x, y) => x * y).reduce((s, x) => s + x, 0)],
  cross: ([a, b]) => {
    const [ax = 0, ay = 0, az = 0] = need(a), [bx = 0, by = 0, bz = 0] = need(b);
    return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  },
  min: ([a, b]) => zip(need(a), need(b), Math.min), max: ([a, b]) => zip(need(a), need(b), Math.max),
  pow: ([a, b]) => zip(need(a), need(b), Math.pow),
  mix: ([a, b, t]) => zip(need(a), zip(zip(need(b), need(a), (y, x) => y - x), need(t), (d, f) => d * f), (x, d) => x + d),
  clamp: ([a, lo, hi]) => zip(zip(need(a), need(lo), Math.max), need(hi), Math.min),
  float: ([a]) => [need(a)[0] ?? 0],
  vec2: args => construct(args, 2), vec3: args => construct(args, 3), vec4: args => construct(args, 4),
};

function need(v: GlslValue | undefined): GlslValue { if (v === undefined) throw new Error('glsl: missing argument'); return v; }
function map(v: GlslValue | undefined, f: (x: number) => number): GlslValue { return need(v).map(f); }
function zip(a: GlslValue, b: GlslValue, f: (x: number, y: number) => number): GlslValue {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => f(a[i % a.length] ?? 0, b[i % b.length] ?? 0));
}
function construct(args: readonly GlslValue[], n: number): GlslValue {
  const flat = args.flat();
  if (flat.length === 1) return Array.from({ length: n }, () => flat[0] ?? 0);
  if (flat.length !== n) throw new Error(`glsl: vec${n} from ${flat.length} components`);
  return flat;
}

/** a uniform's value as GLSL components */
export function uniformValue(value: unknown): GlslValue {
  if (typeof value === 'number') return [value];
  if (value instanceof THREE.Vector2 || value instanceof THREE.Vector3 || value instanceof THREE.Vector4) return value.toArray();
  if (value instanceof THREE.Color) return [value.r, value.g, value.b];
  throw new Error('glsl: a uniform the evaluator cannot read');
}

/** Run a stage body's declarations in order and return the named value (an identifier, or any subset expression). */
export function evalGlsl(body: string, result: string, uniforms: Readonly<Record<string, THREE.IUniform>>): GlslValue {
  const env = new Map<string, GlslValue>();
  for (const [name, u] of Object.entries(uniforms)) if (typeof u.value === 'number' || u.value instanceof THREE.Vector2 || u.value instanceof THREE.Vector3 || u.value instanceof THREE.Vector4 || u.value instanceof THREE.Color) env.set(name, uniformValue(u.value));
  for (const statement of body.split(';').map(s => s.trim()).filter(s => s !== '')) {
    const m = /^(?:float|vec2|vec3|vec4)\s+(\w+)\s*=\s*([\s\S]+)$/.exec(statement);
    if (m === null) throw new Error(`glsl: not a declaration: ${statement.slice(0, 60)}`);
    env.set(m[1] ?? '', expression(m[2] ?? '', env));
  }
  return expression(result, env);
}

/** evaluate one expression of the subset */
function expression(source: string, env: ReadonlyMap<string, GlslValue>): GlslValue {
  const tokens = source.match(/\d+\.\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?|\d+(?:e[+-]?\d+)?|[A-Za-z_]\w*|[-+*/(),.]/g) ?? [];
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const take = (want?: string): string => {
    const t = tokens[at++];
    if (t === undefined || (want !== undefined && t !== want)) throw new Error(`glsl: expected ${want ?? 'a token'} in ${source.slice(0, 60)}`);
    return t;
  };
  const primary = (): GlslValue => {
    const t = take();
    let v: GlslValue;
    if (t === '(') { v = sum(); take(')'); }
    else if (t === '-') v = need(primary()).map(x => -x);
    else if (/^[\d.]/.test(t)) v = [Number(t)];
    else if (peek() === '(') {
      take('('); const args: GlslValue[] = [];
      if (peek() !== ')') for (;;) { args.push(sum()); if (peek() !== ',') break; take(','); }
      take(')');
      const f = BUILTINS[t]; if (f === undefined) throw new Error(`glsl: unknown function ${t}`);
      v = f(args);
    } else { const known = env.get(t); if (known === undefined) throw new Error(`glsl: unknown name ${t}`); v = known; }
    while (peek() === '.') {
      take('.'); const mask = take(), from = v;
      v = [...mask].map(c => { const x = from['xyzw'.indexOf(c)] ?? from['rgba'.indexOf(c)]; if (x === undefined) throw new Error(`glsl: swizzle ${mask}`); return x; });
    }
    return v;
  };
  const product = (): GlslValue => {
    let v = primary();
    while (peek() === '*' || peek() === '/') { const op = take(), r = primary(); v = zip(v, r, op === '*' ? (x, y) => x * y : (x, y) => x / y); }
    return v;
  };
  const sum = (): GlslValue => {
    let v = product();
    while (peek() === '+' || peek() === '-') { const op = take(), r = product(); v = zip(v, r, op === '+' ? (x, y) => x + y : (x, y) => x - y); }
    return v;
  };
  const v = sum();
  if (at !== tokens.length) throw new Error(`glsl: trailing ${tokens.slice(at, at + 4).join(' ')} in ${source.slice(0, 60)}`);
  return v;
}
