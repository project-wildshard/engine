/**
 * A shared product's copy identity (SHARD-PLATFORM SF52 / G220, agent playtest 1). The grid's template cells are copies of
 * ONE admitted product (one set of immutable bytes, one material and view set: GridSession.admitTiles), so every copy
 * looked the same. Each copy now reads distinct without a second product: its catalogue placement declares an `identity`
 * (data only, `catalogue.ts`): a HUD accent from the platform's 20 (the HUD swaps to it inside that cell, gridHud.ts) and
 * the cell-local spots where its number stands as a panel on its own structures (the tower landmark, each entry's set
 * piece). The panels are seven-segment digits in the copy's accent on a dark plate, built here as two merged meshes per
 * copy (≈ 2 draws, a few KB of vertices), unlit so they read through the haze, no collider (flush with or above the
 * structure they name). A declared `layout` adds the copy's own landmarks on its plots (copyLayout.ts). A placement without
 * `identity` (every ordinary shard, the solo template) gets nothing.
 */
import { BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { catalogueDocument } from '../../../shared/game/grid/catalogueDocument';
import { ACCENTS } from '@wildshard/format/accent';
import { parseGridCatalogue, type CopyIdentity } from '../../../shared/game/grid/catalogue';
import { copyLayoutMesh } from './copyLayout';

/** a copy's number from its stable instance id (`template-2` → 2), as G222's title card reads it; null when it has none */
export function copyNumber(instance: string): number | null {
  const m = /-(\d+)$/u.exec(instance);
  return m?.[1] === undefined ? null : Number(m[1]);
}

let shipped: ReadonlyMap<string, CopyIdentity> | null = null;
/** the shipped catalogue's copy identities by instance (every mode's placements) */
function shippedIdentities(): ReadonlyMap<string, CopyIdentity> {
  if (shipped !== null) return shipped;
  const data = parseGridCatalogue(catalogueDocument().grid), out = new Map<string, CopyIdentity>();
  for (const row of data.cells) if (row.identity !== undefined) out.set(row.instance, row.identity);
  shipped = out;
  return out;
}

/** the HUD accent hex a copy declares for its cell, else null (the shard's own accent applies) */
export function copyAccent(instance: string): string | null {
  const identity = shippedIdentities().get(instance);
  return identity === undefined ? null : ACCENTS[identity.accent];
}

// seven segments in a 0.6 × 1 digit cell centred on the origin: [x0, y0, x1, y1]
const T = 0.13, W = 0.3;
const SEGMENTS = {
  a: [-W, 0.5 - T, W, 0.5], b: [W - T, 0, W, 0.5], c: [W - T, -0.5, W, 0], d: [-W, -0.5, W, -0.5 + T],
  e: [-W, -0.5, -W + T, 0], f: [-W, 0, -W + T, 0.5], g: [-W, -T / 2, W, T / 2],
} as const satisfies Record<string, readonly [number, number, number, number]>;
type Segment = keyof typeof SEGMENTS;
const DIGITS: readonly (readonly Segment[])[] = [
  ['a', 'b', 'c', 'd', 'e', 'f'], ['b', 'c'], ['a', 'b', 'g', 'e', 'd'], ['a', 'b', 'g', 'c', 'd'], ['f', 'g', 'b', 'c'],
  ['a', 'f', 'g', 'c', 'd'], ['a', 'f', 'g', 'e', 'd', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['a', 'b', 'c', 'd', 'f', 'g'],
];
/** digit pitch and the plate's margin round the digits (in digit heights) */
const PITCH = 0.85, MARGIN = 0.28;
const PLATE = 0x15181d;

/** the panel rectangles for `n` in a unit-height frame facing +z: digits at z = +0.02, the plate at 0 */
export function numberQuads(n: number): { digits: (readonly [number, number, number, number])[]; plate: readonly [number, number, number, number] } {
  const text = String(Math.max(0, Math.floor(n))), count = text.length, span = (count - 1) * PITCH;
  const digits: (readonly [number, number, number, number])[] = [];
  for (let i = 0; i < count; i++) {
    const dx = -span / 2 + i * PITCH, segs = DIGITS[Number(text[i])] ?? [];
    for (const s of segs) { const [x0, y0, x1, y1] = SEGMENTS[s]; digits.push([x0 + dx, y0, x1 + dx, y1]); }
  }
  return { digits, plate: [-span / 2 - W - MARGIN, -0.5 - MARGIN, span / 2 + W + MARGIN, 0.5 + MARGIN] };
}

const corner = new Vector3();
/** push one rectangle (frame-local, size-scaled, at depth z) as two triangles through `m`, front faces toward the frame's +z */
function pushQuad(out: number[], m: Matrix4, r: readonly [number, number, number, number], size: number, z: number): void {
  const [x0, y0, x1, y1] = r;
  for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]] as const) {
    corner.set(x * size, y * size, z).applyMatrix4(m); out.push(corner.x, corner.y, corner.z);
  }
}

/**
 * The copy's number panels under its cell root, or null when the placement declares no identity or the instance has no
 * number. Dispose with the returned `dispose` (the geometries and the two materials).
 */
export function copyMarks(instance: string, identity: CopyIdentity | undefined): { object: Group; dispose: () => void } | null {
  const n = copyNumber(instance);
  if (identity === undefined || n === null || identity.marks.length === 0) return null;
  // G220 pass 2: the copy's own landmarks on its plots (copyLayout.ts), under the same root and disposed with the panels
  const layout = copyLayoutMesh(identity);
  const digits: number[] = [], plates: number[] = [], quads = numberQuads(n), m = new Matrix4();
  for (const mark of identity.marks) {
    m.makeRotationY(mark.yaw).setPosition(mark.x, mark.y, mark.z);
    pushQuad(plates, m, quads.plate, mark.size, 0.04);
    for (const q of quads.digits) pushQuad(digits, m, q, mark.size, 0.08);
  }
  const geometry = (positions: number[]): BufferGeometry => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(positions, 3)); g.computeBoundingSphere(); return g; };
  const digitGeometry = geometry(digits), plateGeometry = geometry(plates);
  const digitMaterial = new MeshBasicMaterial({ color: ACCENTS[identity.accent] }), plateMaterial = new MeshBasicMaterial({ color: PLATE });
  const object = new Group(); object.name = `copy-identity:${instance}`;
  const plate = new Mesh(plateGeometry, plateMaterial), number = new Mesh(digitGeometry, digitMaterial);
  plate.name = 'copy-identity-plate'; number.name = 'copy-identity-number'; number.renderOrder = 1;
  object.add(plate, number); if (layout !== null) object.add(layout.mesh);
  return { object, dispose: () => { digitGeometry.dispose(); plateGeometry.dispose(); digitMaterial.dispose(); plateMaterial.dispose(); layout?.dispose(); object.removeFromParent(); } };
}
