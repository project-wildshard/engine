// The look loop's nine fixed cameras on one anchor (docs/look-loop.md, step 1). Pure: views.mjs shoots them, the tests
// pin the maths. Yaw convention: a yaw faces (-sin yaw, -cos yaw) in x / z, the player's own (`player.spawn(x, z, yaw)`).
import * as v from 'valibot';

/** Shot ids by camera number - 1. The sheet's cells follow this order, three per row. */
export const SHOTS = Object.freeze(['fp-front', 'fp-left', 'fp-right', 'fp-back', 'top', 'diag-front', 'diag-left', 'diag-right', 'diag-back']);

/** RotateGate.ts's query, `(orientation: landscape) and (pointer: coarse) and (min-aspect-ratio: 5/4)`, for a touch viewport.
 * @param {readonly [number, number]} viewport */
const rotateGated = ([w, h]) => w * 4 >= h * 5;

const finite = v.pipe(v.number(), v.finite());
const xz = v.object({ x: finite, z: finite });
const size = v.tuple([v.pipe(v.number(), v.integer(), v.minValue(16)), v.pipe(v.number(), v.integer(), v.minValue(16))]);
const camera = v.looseObject({ n: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(9)), id: v.picklist(SHOTS), mode: v.picklist(['fp', 'god']) });
const anchor = v.looseObject({
  id: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]*$/u, 'anchor ids are lowercase words joined by -')),
  name: v.optional(v.string()), P: xz, faceTo: xz,
  groundY: v.optional(finite), cameras: v.optional(v.pipe(v.array(camera), v.length(9))),
});
const file = v.pipe(v.looseObject({
  about: v.optional(v.string()),
  /** the build's query for both contexts, e.g. `chunk=<slug>&mute=1&skipintro=1&nolock=1&sw=0` */
  query: v.optional(v.string(), ''),
  /** pause > Settings > Debug picks set before the load (time, weather, ...): the world freeze, never a URL switch */
  settings: v.optional(v.record(v.string(), v.union([v.string(), v.number(), v.boolean()])), {}),
  fp: v.looseObject({ viewport: size, dpr: v.optional(finite, 3), pitch: v.optional(finite, -0.06), query: v.optional(v.string(), ''), tier: v.optional(v.string(), 'phone') }),
  god: v.looseObject({
    viewport: size, query: v.optional(v.string(), ''), tier: v.optional(v.string(), 'desktop'),
    fovV: v.optional(finite, 72), topUp: v.optional(finite, 90), diagUp: v.optional(finite, 45), diagOut: v.optional(finite, 55), lookAhead: v.optional(finite, 20),
  }),
  anchors: v.pipe(v.array(anchor), v.minLength(1),
    v.check(list => new Set(list.map(a => a.id)).size === list.length, 'anchor ids must be unique')),
}), v.check(f => f.fp.tier !== 'phone' || !rotateGated(f.fp.viewport),
  'a phone FP viewport must be portrait (narrower than 5:4): the game covers a landscape touch phone with its rotate page and stops the frame loop; use fp.tier "desktop" for a landscape shot'));

/** Admit a cameras.json; defaults are Pine Hollow's (topUp 90, diagUp 45, diagOut 55, god fov 72°, FP pitch -0.06).
 * @param {unknown} value */
export function parseCameraFile(value) { return v.parse(file, value); }

const r3 = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;
/** @param {number} yaw @returns {[number, number]} the unit x / z a yaw faces */
export const facing = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];
/** @param {{x:number,z:number}} from @param {{x:number,z:number}} to the yaw at `from` that faces `to` */
export const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

/** The nine cameras of one anchor, from P, faceTo and the ground height at P (docs/look-loop.md's table).
 * 1-4 first person at P (front, left, right, back), 5 TOP straight down with the front heading image-up, 6-9 the DIAG
 * cameras up and out, front / left / right / back, looking at P (6 at a point lookAhead m ahead of P).
 * @param {ReturnType<typeof parseCameraFile>} def @param {{P:{x:number,z:number},faceTo:{x:number,z:number}}} a @param {number} groundY */
export function resolveCameras(def, a, groundY) {
  const f = yawTo(a.P, a.faceTo), G = def.god, P = a.P;
  const [fx, fz] = facing(f), [lx, lz] = facing(f + Math.PI / 2);
  const at = [r3(P.x), r3(groundY), r3(P.z)];
  /** @param {number} n @param {number} yaw */
  const fp = (n, yaw) => ({ n, id: SHOTS[n - 1], mode: 'fp', x: P.x, z: P.z, yaw: r3(yaw), pitch: def.fp.pitch });
  /** @param {number} n @param {number} px @param {number} pz @param {number} up @param {number[]} look */
  const god = (n, px, pz, up, look) => ({ n, id: SHOTS[n - 1], mode: 'god', pos: [r3(px), r3(groundY + up), r3(pz)], look: look.map(r3), fovV: G.fovV });
  return [
    fp(1, f), fp(2, f + Math.PI / 2), fp(3, f - Math.PI / 2), fp(4, f + Math.PI),
    { ...god(5, P.x, P.z, G.topUp, at), up: [r3(fx), 0, r3(fz)] },
    god(6, P.x - fx * G.diagOut, P.z - fz * G.diagOut, G.diagUp, [P.x + fx * G.lookAhead, groundY, P.z + fz * G.lookAhead]),
    god(7, P.x + lx * G.diagOut, P.z + lz * G.diagOut, G.diagUp, at),
    god(8, P.x - lx * G.diagOut, P.z - lz * G.diagOut, G.diagUp, at),
    god(9, P.x + fx * G.diagOut, P.z + fz * G.diagOut, G.diagUp, at),
  ];
}

/** Fill every anchor that has no cameras yet; an anchor with cameras keeps them verbatim, so each later round re-shoots
 * exactly the first round's frames. Returns the ids it resolved.
 * @param {ReturnType<typeof parseCameraFile>} def @param {(a: {P:{x:number,z:number}}) => number} groundAt */
export function resolveMissing(def, groundAt) {
  const done = [];
  for (const a of def.anchors) {
    if (a.cameras) continue;
    a.groundY = r3(groundAt(a));
    a.cameras = resolveCameras(def, a, a.groundY);
    done.push(a.id);
  }
  return done;
}

/** Playwright context options for a group. Only a phone tier FP context is a phone (the device's UA, isMobile, touch at
 * fp.dpr); every other tier is a plain desktop context. A touch context with a landscape viewport would sit behind the
 * game's rotate page forever (frameGate() false), which is how LF1-0 and LF1-3's desktop FP shots hung.
 * @param {ReturnType<typeof parseCameraFile>} def @param {'fp' | 'god'} mode
 * @param {{userAgent: string, isMobile: boolean, hasTouch: boolean}} phone e.g. Playwright's devices['iPhone 16 Pro'] */
export function contextOptions(def, mode, phone) {
  const g = mode === 'fp' ? def.fp : def.god, dpr = mode === 'fp' ? def.fp.dpr : 1;
  const base = { deviceScaleFactor: dpr, viewport: { width: g.viewport[0], height: g.viewport[1] } };
  return mode === 'fp' && def.fp.tier === 'phone' ? { userAgent: phone.userAgent, isMobile: phone.isMobile, hasTouch: phone.hasTouch, ...base } : base;
}

/** A capture's file name; targets.py and palette-delta.py find frame n by `capture-<n>-*` / `mockup-<n>-*`.
 * @param {string} tag @param {{n:number,id:string}} c */
export const captureName = (tag, c) => `${tag ? `${tag}-` : ''}capture-${c.n}-${c.id}.jpg`;

/** Parse `--name=value` flags; a bare `--name` is `true`. Unknown flags are refused so a typo never shoots the wrong set.
 * @param {string[]} argv @param {readonly string[]} known */
export function parseFlags(argv, known) {
  /** @type {Record<string, string | true>} */
  const out = {};
  for (const word of argv) {
    const m = /^--([a-z][a-z-]*)(?:=(.*))?$/u.exec(word);
    if (!m || !known.includes(m[1])) throw new Error(`unknown argument ${word}; known: ${known.map(k => `--${k}`).join(' ')}`);
    out[m[1]] = m[2] ?? true;
  }
  return out;
}
