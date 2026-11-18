import { parseWorldScenePlacementPage, type WorldScenePlacementPage } from '@wildshard/format/worldScenePlacement';

// MG10 / ENGINE-MEMORY EM17: a scene placement page admitted straight from its JSON text. Nine's boot allocated about
// 110 MB parsing 6 MB of pages through `parseWorldScenePlacementPage`: a property descriptor per key for the JSON guard,
// entry and item copies, valibot's rebuilt output and the failed branch of the pose union for every yxz pose.
// A value fresh from `JSON.parse` is plain data by construction (own enumerable data properties, ordinary prototypes,
// dense arrays, no symbols, accessors or cycles), so the guard reduces to its node and depth bounds and canonical numbers.
// A page whose every object, tuple and record matches the schema exactly is what valibot would rebuild, so it is used as
// it stands. Anything else goes to `parseWorldScenePlacementPage`, which stays the contract and the only source of
// refusals: this never admits a page the schema refuses (the differential fuzz in placement-page-text.test.ts).
//
// The same code is shard-format's `src/format/placement-page-text.ts` + `parsed-json.ts` on format main. MG8 holds this
// engine on format 0.21.0; when the pin reaches the release carrying it, import `@wildshard/format/placement-page-text`
// and delete this file.

type Fields = Readonly<Record<string, unknown>>;
type Check = (value: unknown) => boolean;
type Entries = readonly (readonly [string, Check])[];

const fields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const items = (value: unknown): readonly unknown[] | undefined => Array.isArray(value) ? value : undefined;
const own = (value: Fields, key: string): unknown => Object.hasOwn(value, key) ? value[key] : undefined;

/** `isJsonData`'s verdict for a `JSON.parse` value: at most 100,000 values, none deeper than 64, every number finite and
 *  not -0. `skip` leaves one key of the root object out, as `placementPageData`'s split checks do. */
function parsedJsonFits(root: unknown, skip?: string): boolean {
  let nodes = 0;
  const fits = (value: unknown, depth: number, leave?: string): boolean => {
    if (++nodes > 100_000 || depth > 64) return false;
    if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) if (!fits(value[index], depth + 1)) return false;
      return true;
    }
    if (!fields(value)) return true;
    for (const key in value) if (Object.hasOwn(value, key) && key !== leave && !fits(value[key], depth + 1)) return false;
    return true;
  };
  return fits(root, 0, skip);
}
/** An array of at most `max` items, each passing `check`. */
function listOf(value: unknown, max: number, check: Check): boolean {
  const list = items(value);
  if (list === undefined || list.length > max) return false;
  for (let index = 0; index < list.length; index++) if (!check(list[index])) return false;
  return true;
}
const poseFits = (pose: unknown): boolean => parsedJsonFits(pose);
/** `placementPageData`'s verdict for a `JSON.parse` value. */
function parsedPageData(page: unknown): boolean {
  const rows = fields(page) ? items(own(page, 'rows')) : undefined;
  if (rows === undefined || rows.length > 16) return false;
  if (rows.length !== 1) return parsedJsonFits(page);
  const [row] = rows;
  return parsedJsonFits(page, 'rows') && fields(row) && parsedJsonFits(row, 'poses') && listOf(own(row, 'poses'), 8192, poseFits);
}

const idOk = (value: unknown): boolean => typeof value === 'string' && value.length > 0 && value.length <= 256;
const finiteOk = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= -1e6 && value <= 1e6;
const distanceOk = (value: unknown): boolean => finiteOk(value) && value >= 0;
const boolOk = (value: unknown): boolean => typeof value === 'boolean';
const finites = (value: unknown, length: number): value is readonly number[] => Array.isArray(value) && value.length === length && listOf(value, length, finiteOk);
const pairOk = (value: unknown): boolean => finites(value, 2), tripleOk = (value: unknown): boolean => finites(value, 3);
const matrixOk = (value: unknown): boolean => finites(value, 16);
const oneOf = (...options: readonly unknown[]): Check => (value: unknown): boolean => options.includes(value);
/** Every key of `value`, inherited enumerable ones too (valibot's strict check reads them), is known. */
function keysWithin(value: Fields, known: ReadonlySet<string>): boolean {
  for (const key in value) if (!known.has(key)) return false;
  return true;
}
/** Absent, or own and passing: an inherited value would be rebuilt as own. */
const optional = (value: Fields, key: string, check: Check): boolean => !(key in value) || Object.hasOwn(value, key) && check(value[key]);
function allPass(value: Fields, entries: Entries, need: boolean): boolean {
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry === undefined) continue;
    const key = entry[0], check = entry[1];
    if (need ? !Object.hasOwn(value, key) || !check(value[key]) : !optional(value, key, check)) return false;
  }
  return true;
}
/** A strict object of `need` and `may` fields, its key lists built once: a call allocates nothing. */
function strictShape(need: Readonly<Record<string, Check>>, may: Readonly<Record<string, Check>>): Check {
  const known = new Set([...Object.keys(need), ...Object.keys(may)]), needed: Entries = Object.entries(need), allowed: Entries = Object.entries(may);
  return (value: unknown): boolean => fields(value) && keysWithin(value, known) && allPass(value, needed, true) && allPass(value, allowed, false);
}
// Loops are indexed, not for-of or destructuring: in the interpreter those allocate an iterator result per step, and
// Nine's pages have ~600k values (MG10 measured 14 MB of them).
// valibot's record drops these keys from its output
const DROPPED = new Set(['__proto__', 'prototype', 'constructor']);
function paramsOk(value: unknown): boolean {
  if (!fields(value)) return false;
  for (const key in value) if (!Object.hasOwn(value, key) || DROPPED.has(key) || !idOk(key)) return false;
  return true;
}
const yxzOk = strictShape({ yaw: finiteOk, scale: finiteOk }, { yawAtan2: pairOk, pitch: finiteOk, roll: finiteOk });
const POSE_MAY = { variant: idOk, color: tripleOk, params: paramsOk };
const matrixPoseOk = strictShape({ x: finiteOk, y: finiteOk, z: finiteOk, matrix: matrixOk }, POSE_MAY);
const yxzPoseOk = strictShape({ x: finiteOk, y: finiteOk, z: finiteOk, yxz: yxzOk }, POSE_MAY);
/** The schema's pose union: one of its two strict objects, never both. */
function poseOk(value: unknown): boolean {
  if (!fields(value)) return false;
  const matrix = Object.hasOwn(value, 'matrix');
  if (matrix === Object.hasOwn(value, 'yxz')) return false;
  return matrix ? matrixPoseOk(value) : yxzPoseOk(value);
}
const tierPairOk = strictShape({ phone: distanceOk, desktop: distanceOk }, {});
const tierNumberOk = (value: unknown): boolean => distanceOk(value) || tierPairOk(value);
const cullOk = strictShape({}, { far: tierNumberOk, keepNear: finiteOk, minAngular: tierNumberOk, view: oneOf('forest'), flat: boolOk,
  from: oneOf('origin', 'bounds'), lodBy: oneOf('copy', 'set'), bounds: oneOf('sphere', 'box'), frustum: boolOk, radiusBias: finiteOk, step: distanceOk });
const boxesOk = (value: unknown): boolean => listOf(value, 49_152, finiteOk) && Array.isArray(value) && value.length % 6 === 0;
const drawnIntoOk = strictShape({ part: idOk, boxes: boxesOk }, {});
/** A profile knot: a finite triple whose height is a distance. */
function knotOk(knot: unknown): boolean {
  return finites(knot, 3) && distanceOk(knot[1]);
}
/** Knots rise strictly along their first value. */
function rises(knots: readonly unknown[]): boolean {
  let before = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < knots.length; index++) {
    const knot = knots[index], along = finites(knot, 3) ? knot[0] ?? Number.NaN : Number.NaN;
    if (!(along > before)) return false;
    before = along;
  }
  return true;
}
function profileOk(value: unknown): boolean {
  const knots = items(value);
  return knots !== undefined && knots.length >= 2 && listOf(knots, 8, knotOk) && rises(knots);
}
const floorOk = strictShape({ x: finiteOk, z: finiteOk, hw: distanceOk, hd: distanceOk, y: finiteOk }, { rot: finiteOk, slope: finiteOk, tilt: finiteOk, profile: profileOk });
const splitOk = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2048;
const pieceOk = strictShape({ id: idOk }, { follows: oneOf('copy'), solidFloor: boolOk, floorPolicy: oneOf('first', 'highest'),
  floors: (value: unknown): boolean => listOf(value, 4096, floorOk), name: idOk, split: splitOk });
const rowOk = strictShape(
  { id: idOk, model: idOk, draw: oneOf('single', 'instanced', 'batched', 'merged'), poses: (value: unknown): boolean => listOf(value, 8192, poseOk) },
  { tier: oneOf('phone', 'desktop'), batch: idOk, name: idOk, drawnInto: drawnIntoOk, cull: cullOk, sortObjects: boolOk,
    colliders: (value: unknown): boolean => Array.isArray(value) && value.length <= 32_768, piece: pieceOk });
const rowId = (row: unknown): unknown => fields(row) ? own(row, 'id') : row;
const rowsOk = (value: unknown): boolean => listOf(value, 16, rowOk) && Array.isArray(value) && value.length > 0
  && new Set(value.map((row: unknown): unknown => rowId(row))).size === value.length;
const pageShapeOk = strictShape({ version: oneOf(1), rows: rowsOk }, {});

/** True when `value`, fresh from `JSON.parse`, is a placement page `parseWorldScenePlacementPage` admits and would rebuild
 *  unchanged (key order aside). False is no verdict: the caller asks the schema. Only for `JSON.parse` output. */
export function plainPlacementPage(value: unknown): value is WorldScenePlacementPage {
  return parsedPageData(value) && pageShapeOk(value);
}
/** A placement page from its JSON text: used as it stands when it is plain and exact, otherwise through
 *  `parseWorldScenePlacementPage` (its output, or its refusal). */
export function parseWorldScenePlacementPageText(text: string): WorldScenePlacementPage {
  const value: unknown = JSON.parse(text);
  return plainPlacementPage(value) ? value : parseWorldScenePlacementPage(value);
}
