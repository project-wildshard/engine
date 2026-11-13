import type { RoadSignSource } from './roadSignPaint';
/**
 * The platform's road system in one call (SHARD-PLATFORM SF17b look and per-view budget, G144 admission): the seams' solid
 * parts and curtain (`seamLook.ts`), the boulevard (`roadLook.ts`), the void and its rail (`voidLook.ts`), and the deck: the
 * seams, kerbs, islands, streetlights and the void's rail + posts as ONE solid mesh (`roadSolid.ts`) plus the seams' additive
 * curtain, every road mesh culled per view (`roadCull.ts`).
 *
 * Six allocations, each with an exact preflight byte plan (retained JS: typed arrays, canvases and the grain data; GPU:
 * vertex and index buffers and every mip level): `road.asphalt`, `road.junctions`, `road.signs`, `road.void`, `road.deck`
 * (with the grain array it alone samples) and `road.curtain`. Each is built only after its plan is admitted and
 * disposes on the admission's child scope; a refusal never builds. G112 removed the unmetered grid composition.
 *
 * Construction transients (the meshers' number arrays, the seams' split parts, the solid parts the deck merges) are made
 * before the deck's and the boulevard's claims and dropped after; the curtain's split arrays become its geometry without a
 * copy (they are counted in `road.curtain`).
 */
import { Mesh, type Camera, type Object3D } from 'three';
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { ownRoadMesh } from './roadResources';
import type { RoadTileBacking } from './roadTileBacking';
import type { RoadGrainSource } from './roadGrain';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import type { GridCell } from '../../../shared/game/grid/assembly';
import type { LookScope, RoadLayout } from '../../../shared/game/grid/roadLayout';
import { allocateRenderSteps, type PlatformRenderAdmission } from './renderResidency';
import { installRoadLookSteps, RoadOverlayLight, type RoadLookState } from './roadLook';
import { installVoidLook } from './voidLook';
import { CURTAIN_FLOATS, curtainGeometry, curtainMaterial, curtainSource, gravel, riprap, seamSolidSteps, stone, strata } from './seamLook';
import type { SeamGeometryChannels, SeamLookState, SeamPiece } from '../../../shared/game/grid/seamGeometry';
import { bytePlan, cullIntoSteps, finishRoadSteps, gpuOnlyRoad, meshBytesSteps, ROAD_LOD, type CullPlan, type RoadCuller } from './roadCull';
import { GRAIN_LAYERS, GRAIN_SIZE, gpuOnlyTextureBytes, grainArray, SOLID_FLOATS, solidGeometrySteps, solidMaterial, solidSource, type SolidPart } from './roadSolid';

/** What the road system reads and where it draws. */
export interface PlatformRoadInput {
  /** the generator's strips (the same triangles the colliders use) */
  readonly strips: readonly SeamPiece[];
  /** Source-verified channels for exactly this selected ring, absent on native/outer construction. */
  readonly seamChannels?: SeamGeometryChannels;
  readonly grain?: RoadGrainSource;
  readonly signs?: RoadSignSource;
  readonly home: GridCell;
  readonly pitch: number;
  readonly layout: RoadLayout;
  readonly scene: Object3D;
  readonly scope: LookScope;
  /** the view camera the per-view cull follows (absent: every camera culls) */
  readonly camera?: () => Camera | undefined;
  /** each culled mesh's plan, for the budget readouts (`roadViewCost`, `roadResident`) */
  readonly plans: Map<Mesh, CullPlan>;
  /** G144: admit each allocation's byte plan before building it. */
  readonly admission: PlatformRenderAdmission;
  /** Distinct allocation namespace for independently prepared pieces of one road session. */
  readonly allocationKey?: string;
  /** Optional async-only tile archive; default construction retains the original road look. */
  readonly tileBacking?: RoadTileBacking;
  /** loading-speed A1 (ring-first): build only the strips and road pieces standing at these grid points (absent: all) */
  readonly within?: (x: number, z: number) => boolean;
  /** build the void floor and its rail (default true; one build of a split road draws it) */
  readonly voidFloor?: boolean;
}
/** The readouts and the roots the road budget measures. */
export interface PlatformRoad {
  readonly road: RoadLookState; readonly seams: SeamLookState; readonly roots: readonly Object3D[];
  readonly tileBacking?: RoadTileBacking;
  /** G321: the void floor's fade by how much a cell's own sky owns the horizon (`VoidLookState.fade`) */
  readonly horizon: (owned: number) => void;
  /** G103: the road's weight in the frame, so the asphalt forced into a cell keeps the road's light (`RoadOverlayLight`) */
  readonly overlayLight: (roadWeight: number) => void;
}


/** Install the platform's road system; everything disposes with `scope` (or, admitted, with each allocation's child scope). */
export function installPlatformRoad(input: PlatformRoadInput): PlatformRoad {
  if (input.tileBacking !== undefined) throw new Error('Road tile backing requires async construction');
  const road = finishRoadSteps(platformRoadSteps(input));
  if (road === undefined) throw new Error('Road construction cancelled');
  return road;
}

/** How long road construction runs before it asks `pause` (ms). In play the outer road builds right after controls, beside
 *  the frame's own work, and `pause` only ends the stretch once the frame's shared build budget is spent: 12 ms stretches
 *  left spawn frames 50-80 ms apart on the Simulator (T10). Loading screens pause only after their own longer stretch. */
const ROAD_SLICE_MS = 4;
/** Paint between admission and cull batches; synchronous callers retain the identical ordered builder. */
export async function installPlatformRoadSliced(input: PlatformRoadInput, pause: () => Promise<void>, options: { readonly budgetMs?: number; readonly now?: () => number } = {}): Promise<PlatformRoad> {
  const budget = options.budgetMs ?? ROAD_SLICE_MS, now = options.now ?? diagnosticNow;
  if (!Number.isFinite(budget) || budget < 0) throw new RangeError('Invalid road construction slice budget');
  const steps = platformRoadSteps(input);
  let start = now(), completed = false;
  try {
    for (;;) {
      const next = steps.next();
      const flush = input.tileBacking?.flush(); if (flush !== undefined && flush !== null) await flush;
      if (next.done === true) {
        if (next.value === undefined) throw new Error('Road construction cancelled');
        // DL11: the road lands (and control waits for it) only once its worker-captured tiles are archived
        await input.tileBacking?.joinCapture();
        completed = true; return next.value;
      }
      if (now() - start >= budget) { await pause(); start = now(); }
    }
  } finally {
    if (!completed) {
      try { steps.return(undefined); }
      finally { await input.tileBacking?.settlePending(); }
    }
  }
}

/** the layout's pieces standing at points `within` accepts (the rail stays: it belongs to the void floor) */
function layoutWithin(layout: RoadLayout, within: (x: number, z: number) => boolean): RoadLayout {
  return { segments: layout.segments.filter(s => within(s.centre.x, s.centre.z)), junctions: layout.junctions.filter(j => within(j.centre.x, j.centre.z)),
    signs: layout.signs.filter(s => within(s.at.x, s.at.z)), lights: layout.lights.filter(l => within(l.at.x, l.at.z)), rail: layout.rail, edge: layout.edge, holes: layout.holes };
}

/** Two builds of one road system (A1's ring-first halves) as one: their readouts summed, roots joined, hooks shared. */
export function combinePlatformRoads(first: PlatformRoad, second: PlatformRoad): PlatformRoad {
  if (first.tileBacking !== undefined && second.tileBacking !== undefined && first.tileBacking !== second.tileBacking) throw new Error('Road pieces have different backing owners');
  const tileBacking = first.tileBacking ?? second.tileBacking;
  const a = first.road, b = second.road, sa = first.seams, sb = second.seams, buckets: Partial<Record<string, number>> = { ...sa.buckets };
  for (const [bucket, count] of Object.entries(sb.buckets)) buckets[bucket] = (buckets[bucket] ?? 0) + (count ?? 0);
  return {
    road: { segments: a.segments + b.segments, junctions: a.junctions + b.junctions, roundabouts: a.roundabouts + b.roundabouts, signs: a.signs + b.signs, lights: a.lights + b.lights, draws: a.draws + b.draws },
    seams: { triangles: sa.triangles + sb.triangles, draws: sa.draws + sb.draws, buckets },
    roots: [...first.roots, ...second.roots], ...(tileBacking === undefined ? {} : { tileBacking }),
    horizon: (owned) => { first.horizon(owned); second.horizon(owned); },
    overlayLight: (weight) => { first.overlayLight(weight); second.overlayLight(weight); },
  };
}

function* platformRoadSteps(input: PlatformRoadInput): Generator<void, PlatformRoad | undefined> {
  const { home, pitch, scene, scope, within } = input;
  const allocationKey = input.allocationKey;
  if (allocationKey !== undefined && !/^[a-z][a-z0-9.-]{0,39}$/u.test(allocationKey)) throw new Error('Invalid road allocation namespace');
  // Spawn heap (T10): no closure here may capture `input`. The returned road's hooks share this scope's context, so a
  // captured input kept the seam look channels (10 MB of normals at the Driftwood spawn) and the strips for the page's life.
  const inputAdmission = input.admission;
  const admission: PlatformRenderAdmission = allocationKey === undefined ? inputAdmission : {
    allocate: (plan, build) => inputAdmission.allocate({ ...plan, id: `${allocationKey}.${plan.id}` }, build),
    ...(inputAdmission.shrink === undefined ? {} : { shrink: (id: string, bytes: number): void => { inputAdmission.shrink?.(`${allocationKey}.${id}`, bytes); } }),
  };
  const backing = input.tileBacking;
  if (backing !== undefined && admission.shrink === undefined) throw new Error('Road backing requires shrink-only admission');
  const retireGeometry = (mesh: Mesh, id: string, bytes: number): void => { backing?.retirement(mesh, () => { admission.shrink?.(id, bytes); }); };
  const strips = within === undefined ? input.strips : input.strips.filter(strip => within(strip.mesh.origin.x, strip.mesh.origin.z));
  const layout = within === undefined ? input.layout : layoutWithin(input.layout, within);
  const tileSize = backing === undefined ? undefined : CONTENT_CAPS.l0.size;
  const culler: RoadCuller = { pitch, ...(tileSize === undefined ? {} : { tileSize }), plans: input.plans, ...(backing === undefined ? {} : { prepare: (mesh: Mesh, plan: CullPlan): Generator<void, void> => backing.capture(mesh, plan) }), ...(input.camera === undefined ? {} : { camera: input.camera }) };
  // the seams' materials keyed by the generator's feature ranges: the same triangles the world collides with
  const seams = yield* seamSolidSteps(strips, home, undefined, pitch, input.seamChannels);
  const parts: SolidPart[] = [...seams.parts], solid = (part: SolidPart): void => { parts.push(part); };
  const overlayLight = new RoadOverlayLight();
  const road = yield* installRoadLookSteps({ layout, home, scene, scope, solid, cull: culler, admission, overlayLight, retireGeometry,
    ...(input.grain === undefined ? {} : { grain: input.grain }),
    ...(input.signs === undefined ? {} : { signs: input.signs }) });
  const voidLook = input.voidFloor === false ? null : installVoidLook({ rail: layout.rail, edge: layout.edge, holes: layout.holes, home, scene, scope, solid, admission });
  // this build's own boulevard group (a split road adds one per build)
  let boulevard: Object3D | undefined;
  for (const child of scene.children) if (child.name === 'grid-boulevard') boulevard = child;
  const meshes: Mesh[] = [];
  yield;
  const deckBytes = yield* meshBytesSteps(parts.map(solidSource), SOLID_FLOATS, { pitch, ...(tileSize === undefined ? {} : { tileSize }), lod: ROAD_LOD }, true);
  const grainBytes = gpuOnlyTextureBytes(GRAIN_SIZE, GRAIN_SIZE, GRAIN_LAYERS.length, 'data');
  const deckAdmission = bytePlan('road.deck', deckBytes, grainBytes);
  const builtDeck = yield* allocateRenderSteps(admission, deckAdmission, function* buildDeck(owner) {
    yield;
    const grain = grainArray({ gravel, stone, strata, riprap }), material = solidMaterial(grain);
    yield;
    const deck = new Mesh(yield* solidGeometrySteps(parts), material);
    ownRoadMesh(owner, deck, [grain]);
    deck.name = 'grid-deck'; deck.receiveShadow = true;
    deck.castShadow = false; deck.matrixAutoUpdate = false; deck.updateMatrix();
    yield* cullIntoSteps(culler, deck, ROAD_LOD); scene.add(deck); meshes.push(deck);
    gpuOnlyRoad(deck, [grain]); // G144: admitted, its JS copies go on upload (the plan counts them gone)
    return deck;
  });
  if (builtDeck === undefined) throw new Error('Road construction cancelled');
  retireGeometry(builtDeck, deckAdmission.id, grainBytes.jsBytes + grainBytes.gpuBytes);
  const curtainBytes = yield* meshBytesSteps([curtainSource(seams.curtain)], CURTAIN_FLOATS, { pitch, ...(tileSize === undefined ? {} : { tileSize }) }, true);
  const builtCurtain = yield* allocateRenderSteps(admission, bytePlan('road.curtain', curtainBytes), function* buildCurtain(owner) {
    yield;
    const material = curtainMaterial(home), curtain = new Mesh(curtainGeometry(seams.curtain), material);
    ownRoadMesh(owner, curtain, []);
    curtain.name = 'grid-seam-curtain'; curtain.receiveShadow = false;
    curtain.castShadow = false; curtain.matrixAutoUpdate = false; curtain.updateMatrix();
    yield* cullIntoSteps(culler, curtain); scene.add(curtain); meshes.push(curtain);
    gpuOnlyRoad(curtain, []); return curtain;
  });
  if (builtCurtain === undefined) throw new Error('Road construction cancelled');
  retireGeometry(builtCurtain, 'road.curtain', 0);
  // Disposer closures retain this build environment. Only the admitted meshes need to survive;
  // the split/merge sources have already been copied into their final uploaded representation.
  parts.length = 0; seams.parts.length = 0;
  const roots = [...meshes, boulevard, voidLook === null ? undefined : scene.getObjectByName('grid-void')].filter((o): o is Object3D => o !== undefined);
  return { road, seams: seams.state, roots, ...(backing === undefined ? {} : { tileBacking: backing }), horizon: (owned) => { voidLook?.fade(owned); }, overlayLight: (w) => { overlayLight.weight(w); } };
}
