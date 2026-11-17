import { CONTENT_CAPS, GRID_RADIUS, GRID_CELL_COUNT } from '@wildshard/format/contentBounds';
import { diagnosticNow } from '../core/clock';
import { validateEdgeProfile } from './edgeProfiles';
import { SHORE_DEPTH } from './shore';
import { seamGeometry, cornerSeamGeometry, seamGeometrySteps, cornerSeamGeometrySteps, SEAM_OFFSETS, type SeamEdge, type SeamFeature, type SeamTurnIn } from './seamGeometry';

/** Deterministic platform seam data, independent of rendering, devices and physics wrappers. */
export interface StripProfile { readonly heights: readonly number[]; readonly colours: readonly (readonly number[])[]; readonly roadHeight: number }
/** Southwest, southeast, northwest and northeast outer corner values, in that order. */
/** `shore` (G149, the §3.2 shore rule): the corner is seabed below 0 under a sea at exactly 0, so its field never descends. */
export interface StripCorner { readonly height: number; readonly colour: readonly [number, number, number]; readonly shore?: boolean }
/** A regional placement is used only to translate the platform's duplicate collider. */
export interface StripCell { readonly instance: string; readonly origin: { readonly x: number; readonly z: number } }
/** A triangle mesh is local to its origin. Colour triples use the same vertex ordering. */
export interface StripMesh { readonly origin: { readonly x: number; readonly z: number }; readonly positions: Float32Array; readonly indices: Uint32Array; readonly colours: Float32Array }
/** The highway owns the primary mesh; neighbouring worlds receive exact translated duplicates. */
export interface GeneratedStrip { readonly id: string; readonly mesh: StripMesh; readonly duplicates: readonly { readonly instance: string; readonly mesh: StripMesh }[]; readonly features: readonly SeamFeature[]; readonly turnIn?: SeamTurnIn }
/** Declared edge data placed on an integer platform grid; placement never enters a regional simulation. */
export interface PlatformCell extends StripCell { readonly cell: readonly [number, number]; readonly edges: Readonly<Record<'north' | 'east' | 'south' | 'west', StripProfile>>; readonly observations?: Readonly<Record<'north' | 'east' | 'south' | 'west', Omit<SeamEdge, 'profile'>>> }
/** A seam's shape: its mesh in its own frame, features and turn-in, which depend only on its shape key's inputs. */
export interface PlatformShape { readonly mesh: Omit<StripMesh, 'origin'>; readonly features: readonly SeamFeature[]; readonly turnIn?: SeamTurnIn }
/** Full G90 gradient lattice, including the explicit 6/10m re-frame lines. */
export const STRIP_OFFSETS: readonly number[] = SEAM_OFFSETS;
function place(id: string, mesh: StripMesh, cells: readonly StripCell[], features: readonly SeamFeature[], turnIn?: SeamTurnIn): GeneratedStrip {
  if (id.length === 0 || ![mesh.origin.x, mesh.origin.z].every(Number.isFinite) || new Set(cells.map((c) => c.instance)).size !== cells.length
    || cells.some((c) => c.instance.length === 0 || ![c.origin.x, c.origin.z].every(Number.isFinite))) throw new RangeError('Invalid platform placement');
  return { id, mesh, features, ...(turnIn === undefined ? {} : { turnIn }), duplicates: cells.map((cell) => ({ instance: cell.instance, mesh: { ...mesh, origin: { x: mesh.origin.x - cell.origin.x, z: mesh.origin.z - cell.origin.z } } })) };
}
/** Full native profiles run in positive lateral order; mixed rows preserve the sorted union of their vertices. */
export function generateStrip(input: { id: string; axis: 'x' | 'z'; origin: { x: number; z: number }; profiles: readonly [StripProfile, StripProfile]; adjacent: readonly StripCell[]; observations?: readonly [Omit<SeamEdge, 'profile'>, Omit<SeamEdge, 'profile'>] }): GeneratedStrip {
  const edges = input.profiles.map((profile, i): SeamEdge => ({ profile, ...(input.observations?.[i] ?? { entryWidth: 0 }) }));
  const low = edges[0], high = edges[1]; if (low === undefined || high === undefined) throw new Error('Missing platform edge');
  const generated = seamGeometry({ ...input, edges: [low, high] });
  return place(input.id, generated.mesh, input.adjacent, generated.features, generated.turnIn);
}
/** B-clamped corners meet every floor endpoint; retaining walls and cliffs return10m around the junction. */
export function generateCrossroads(input: { id: string; origin: { x: number; z: number }; corners: readonly [StripCorner, StripCorner, StripCorner, StripCorner]; adjacent: readonly StripCell[] }): GeneratedStrip {
  const generated = cornerSeamGeometry(input); return place(input.id, generated.mesh, input.adjacent, generated.features);
}

/** Generate every deck corridor and four-way junction, including the explicit empty-neighbour perimeter. */
export function generatePlatform(cells: readonly PlatformCell[], empty: StripProfile, plans?: Map<string, readonly number[][]>,
  within?: (x: number, z: number) => boolean, known?: ReadonlyMap<string, PlatformShape>): readonly GeneratedStrip[] {
  const steps = platformSteps(cells, empty, plans, within, known);
  for (;;) { const next = steps.next(); if (next.done === true) return next.value; }
}

/**
 * `generatePlatform` in slices (rt3-crossing): the same strips, in the same order, but `pause` is awaited whenever a
 * slice of strip generation has run `budgetMs`, so a page building its platform during a load keeps painting instead of
 * freezing for the whole generation. Native seam certification yields within a strip; output is published only when complete.
 */
export async function generatePlatformSliced(cells: readonly PlatformCell[], empty: StripProfile, pause: () => Promise<void>, budgetMs = 12, plans?: Map<string, readonly number[][]>,
  within?: (x: number, z: number) => boolean, known?: ReadonlyMap<string, PlatformShape>): Promise<readonly GeneratedStrip[]> {
  const steps = platformSteps(cells, empty, plans, within, known);
  let since = diagnosticNow();
  for (;;) {
    const next = steps.next(); if (next.done === true) return next.value;
    if (diagnosticNow() - since >= budgetMs) { await pause(); since = diagnosticNow(); }
  }
}

type StripJob = { readonly kind: 'strip'; readonly key: string; readonly input: Parameters<typeof generateStrip>[0] }
  | { readonly kind: 'cross'; readonly key: string; readonly input: Parameters<typeof generateCrossroads>[0] };

/**
 * SB38e: the shape key of every strip `within` selects, in native order (one per strip; equal shapes repeat). A strip's
 * mesh, features and turn-in are a function of its key alone (the shape cache below relies on it), so a page whose
 * placements changed after the build can reuse every baked shape whose key it still names.
 */
export function platformShapeKeys(cells: readonly PlatformCell[], empty: StripProfile, within?: (x: number, z: number) => boolean): readonly string[] {
  const keys: string[] = [];
  for (const job of platformJobs(cells, empty, within)) keys.push(job.key);
  return keys;
}

/** Shared ordered construction: `within` selects origins before certification, while every selected seam
 * still reads its full original neighbours. Complementary selections retain exact individual meshes. `known` seeds the
 * shape cache with shapes certified elsewhere (the build's, by key), which then are placed exactly as a cached shape is. */
function* platformSteps(cells: readonly PlatformCell[], empty: StripProfile, plans?: Map<string, readonly number[][]>,
  within?: (x: number, z: number) => boolean, known?: ReadonlyMap<string, PlatformShape>): Generator<void, readonly GeneratedStrip[]> {
  const result: GeneratedStrip[] = [];
  // Equal immutable content has equal local mesh bytes. Reuse the certification
  // within this generation, while each segment keeps its own placement and
  // regional duplicates. Optional build plans name every input byte; unlisted shapes are certified here.
  const shapes = new Map<string, GeneratedStrip>();
  const seeded = (key: string, input: { readonly id: string; readonly origin: { readonly x: number; readonly z: number }; readonly adjacent: readonly StripCell[] }): GeneratedStrip | undefined => {
    const seed = known?.get(key); if (seed === undefined) return undefined;
    const shape = place(input.id, { ...seed.mesh, origin: { ...input.origin } }, input.adjacent, seed.features, seed.turnIn); shapes.set(key, shape);
    return shape;
  };
  function* strip(key: string, input: Parameters<typeof generateStrip>[0]): Generator<void, GeneratedStrip> {
    let shape = shapes.get(key) ?? seeded(key, input);
    if (shape === undefined) {
      input.profiles.forEach(validateEdgeProfile);
      const edges = input.profiles.map((profile, i): SeamEdge => ({ profile, ...(input.observations?.[i] ?? { entryWidth: 0 }) }));
      const low = edges[0], high = edges[1]; if (low === undefined || high === undefined) throw new Error('Missing platform edge');
      const generated = yield* seamGeometrySteps({ ...input, edges: [low, high] }, plans === undefined ? undefined : { key, rows: plans });
      shape = place(input.id, generated.mesh, input.adjacent, generated.features, generated.turnIn); shapes.set(key, shape);
    }
    return place(input.id, { ...shape.mesh, origin: { ...input.origin } }, input.adjacent, shape.features, shape.turnIn);
  }
  function* cross(key: string, input: Parameters<typeof generateCrossroads>[0]): Generator<void, GeneratedStrip> {
    let shape = shapes.get(key) ?? seeded(key, input);
    if (shape === undefined) {
      const generated = yield* cornerSeamGeometrySteps(input, plans === undefined ? undefined : { key, rows: plans });
      shape = place(input.id, generated.mesh, input.adjacent, generated.features); shapes.set(key, shape);
    }
    return place(input.id, { ...shape.mesh, origin: { ...input.origin } }, input.adjacent, shape.features);
  }
  for (const job of platformJobs(cells, empty, within)) {
    result.push(yield* (job.kind === 'strip' ? strip(job.key, job.input) : cross(job.key, job.input)));
    yield;
  }
  return result;
}

/** Every strip `within` selects, in native order, with its exact inputs and shape key (validated as construction is). */
function* platformJobs(cells: readonly PlatformCell[], empty: StripProfile, within?: (x: number, z: number) => boolean): Generator<StripJob, void> {
  validateEdgeProfile(empty);
  if (cells.length === 0 || cells.length > GRID_CELL_COUNT || new Set(cells.map((c) => c.instance)).size !== cells.length
    || new Set(cells.map((c) => c.cell.join(','))).size !== cells.length
    || cells.some((c) => c.cell.some((n) => !Number.isInteger(n) || Math.abs(n) > GRID_RADIUS) || c.origin.x !== c.cell[0] * CONTENT_CAPS.pitch || c.origin.z !== c.cell[1] * CONTENT_CAPS.pitch)) throw new RangeError('Invalid platform cells');
  for (const cell of cells) Object.values(cell.edges).forEach(validateEdgeProfile);
  const byCell = new Map(cells.map((c) => [c.cell.join(','), c]));
  const xs = cells.map((c) => c.cell[0]), zs = cells.map((c) => c.cell[1]), minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const get = (x: number, z: number): PlatformCell | undefined => byCell.get(`${x},${z}`);
  const present = (rows: readonly (PlatformCell | undefined)[]): PlatformCell[] => rows.filter((c): c is PlatformCell => c !== undefined);
  // Preserve signed zero: a JSON numeric key alone would conflate distinct bytes.
  const exactKey = (value: unknown): string => JSON.stringify(value, (_key: string, item: unknown) => typeof item === 'number' && Object.is(item, -0) ? '-0' : item);
  const profiles = new WeakMap<StripProfile, string>();
  const profileKey = (profile: StripProfile): string => {
    let key = profiles.get(profile);
    if (key === undefined) { key = exactKey(profile); profiles.set(profile, key); }
    return key;
  };
  const strip = (input: Parameters<typeof generateStrip>[0]): StripJob => ({ kind: 'strip', input,
    key: exactKey([CONTENT_CAPS.pitch, input.axis, input.profiles.map(profileKey), input.observations]) });
  for (let x = minX - 1; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
    if (within !== undefined && !within((x + 0.5) * CONTENT_CAPS.pitch, z * CONTENT_CAPS.pitch)) continue;
    const low = get(x, z), high = get(x + 1, z);
    yield strip({ id: `gap.x.${x}.${z}`, axis: 'x', origin: { x: (x + 0.5) * CONTENT_CAPS.pitch, z: z * CONTENT_CAPS.pitch }, profiles: [low?.edges.east ?? empty, high?.edges.west ?? empty], adjacent: present([low, high]), observations: [low?.observations?.east ?? { entryWidth: 0 }, high?.observations?.west ?? { entryWidth: 0 }] });
  }
  for (let z = minZ - 1; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    if (within !== undefined && !within(x * CONTENT_CAPS.pitch, (z + 0.5) * CONTENT_CAPS.pitch)) continue;
    const low = get(x, z), high = get(x, z + 1);
    yield strip({ id: `gap.z.${x}.${z}`, axis: 'z', origin: { x: x * CONTENT_CAPS.pitch, z: (z + 0.5) * CONTENT_CAPS.pitch }, profiles: [low?.edges.north ?? empty, high?.edges.south ?? empty], adjacent: present([low, high]), observations: [low?.observations?.north ?? { entryWidth: 0 }, high?.observations?.south ?? { entryWidth: 0 }] });
  }
  const corner = (cell: PlatformCell | undefined, horizontal: 'north' | 'south', vertical: 'east' | 'west'): StripCorner => {
    const a = cell?.edges[horizontal] ?? empty, b = cell?.edges[vertical] ?? empty, i = vertical === 'east' ? a.heights.length - 1 : 0, j = horizontal === 'north' ? b.heights.length - 1 : 0;
    const height = a.heights[i] ?? 0, otherHeight = b.heights[j] ?? 0, colour = a.colours[i], otherColour = b.colours[j];
    if (colour === undefined || otherColour === undefined || Math.abs(height - otherHeight) > 0.02 || colour.some((c, k) => Math.abs(c - (otherColour[k] ?? Infinity)) > 1e-6)) throw new RangeError('Authored corner edges disagree');
    // G149: a corner of a shore edge (a sea at exactly 0 over seabed) keeps the strips' floor at 0 round the junction
    const sea = cell?.observations?.[horizontal].waterSurface === 0 || cell?.observations?.[vertical].waterSurface === 0;
    return { height, colour: [colour[0] ?? 0, colour[1] ?? 0, colour[2] ?? 0], ...(sea && height < -SHORE_DEPTH ? { shore: true } : {}) };
  };
  for (let x = minX - 1; x <= maxX; x++) for (let z = minZ - 1; z <= maxZ; z++) {
    if (within !== undefined && !within((x + 0.5) * CONTENT_CAPS.pitch, (z + 0.5) * CONTENT_CAPS.pitch)) continue;
    const sw = get(x, z), se = get(x + 1, z), nw = get(x, z + 1), ne = get(x + 1, z + 1);
    const input = { id: `cross.${x}.${z}`, origin: { x: (x + 0.5) * CONTENT_CAPS.pitch, z: (z + 0.5) * CONTENT_CAPS.pitch }, corners: [corner(sw, 'north', 'east'), corner(se, 'north', 'west'), corner(nw, 'south', 'east'), corner(ne, 'south', 'west')] as const, adjacent: present([sw, se, nw, ne]) };
    yield { kind: 'cross', input, key: exactKey([CONTENT_CAPS.pitch, 'cross', input.corners]) };
  }
}
