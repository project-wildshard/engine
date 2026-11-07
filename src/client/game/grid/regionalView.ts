/**
 * The world-view half of a transitional region's shell (SHARD-PLATFORM SF47 / M3, E452): what a legacy shard's runtime
 * draws and collides with while it runs as a neighbour cell rather than as the page's home.
 *
 * The page keeps one renderer, scene, player and input loop. bootstrap's `registry.onAdd` closes over the HOME physics
 * and scene, so a region cannot share that registry: a piece the runtime registers would collide in the home world.
 * The view owns, per admitted cell,
 *
 * - a root group in the one page scene at the cell's render offset (its origin minus the home origin, the same offset
 *   the live session applies to the camera while the traveller is in that frame), so frame-local content draws in place;
 * - its own `WorldRegistry` whose listener writes the DESTINATION Physics (the region's frame-local world), the root,
 *   its moving pieces and its player floors (the region's `PlayerFrameQueries.platforms`);
 * - `enter(entry)`: while an entered runtime scope lives, the root is visible and the page registry verbs (`ctx.piece`,
 *   `place`, `activeRegistry()`) resolve to this registry, exactly as the frame's physics replaces the page's on a
 *   crossing. Prepared geometry may park across exits, but it is hidden on leave: an inactive neighbour displays only
 *   its shardfile / frozen declared content; while entered, the cell's coarse cover (its far proxy and ring tiles) is
 *   hidden through the scene's `cellCover.ts` port, so the region's own ground is what draws inside its cell (G223);
 * - disposal in dependency order: every piece's colliders and bodies leave the destination world, every object leaves
 *   the scene with its unacquired GPU resources, the registry binding is restored, and its residency hold is released.
 *
 * Memory: the view constructs nothing outside the whole measured runtime claim (`regionalRuntimeAccountedBytes`), which
 * the caller reserves on the page allocator before admission. The view refuses to exist without that live claim and
 * holds it against eviction only during an entered scope. Generic game code: no shard is named here (E405).
 */
import { Group, Scene, type Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { enteredOwner, withOwner } from '@wildshard/engine/app/ownership';
import { ownSceneTree } from '@wildshard/engine/app/sceneOwnership';
import { registerExteriorLighting } from '@wildshard/engine/render/precompile';
import { holdStaticMatrices } from '@wildshard/engine/render/staticMatrices';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { addPiece } from '@wildshard/engine/physics/pieces';
import type { PlayerFrameQueries } from '@wildshard/engine/player/Player';
import { WorldRegistry, type Piece } from '@wildshard/engine/world/registry';
import type { GridCell } from '../../../shared/game/grid/assembly';
import type { ResidencyAllocator, ResidencyLease } from '../../../shared/game/grid/allocator';
import { cellCoverOf } from './cellCover';
import { cellClip } from './cellClip';
import { CHUNK_HALF } from '@wildshard/engine/core/config';

/** The page's registry slot (`App.registryValue`): the frame that owns the traveller owns the registry verbs. */
export interface RegionalRegistrySlot { registryValue: WorldRegistry | null }
/** Which GPU resources the page's asset cache shares; those are never disposed with a region's tree. */
export interface RegionalAssets { isAcquired: (resource: object) => boolean }

export interface RegionalViewRequest {
  readonly cell: GridCell;
  /** The scene's frame: the home cell's grid origin. */
  readonly home: Readonly<{ x: number; z: number }>;
  /** The one page scene (no second renderer). */
  readonly scene: Object3D;
  /** The admitted region's own frame-local physics; never the page's home world. */
  readonly physics: Physics;
  readonly slot: RegionalRegistrySlot;
  readonly assets: RegionalAssets;
  /** The page allocator and the whole-runtime claim the caller reserved for this cell. */
  readonly allocator: ResidencyAllocator;
  readonly claim: ResidencyLease;
  /** The resident's scope; the view lives in a child and is disposed with it at the latest. */
  readonly scope: Scope;
  /** The admitted terrain and water inside the cell (frame-local). */
  readonly ground: Pick<PlayerFrameQueries, 'heightAt' | 'waterSurfaceAt'>;
  /** Subscribe the region's moving-piece poses to the fixed step's pre slot; returns the unsubscribe. */
  readonly fixedPre?: (run: () => void) => () => void;
  /** the page's precompile for one draw, against this view's root's own lights: a clip variant made after the warm-up
   *  links here before it draws (`cellClip`) */
  readonly prepare?: (node: Object3D, root: Object3D) => Promise<void>;
  /** The entered world draws its whole cell's ground itself (manifest `cellGround: 'world'`): the cell's coarse tiles
   *  hide at once on entry instead of waiting for their replacement (G784 / D189). */
  readonly ownGround?: boolean;
}

/** Live counts a leak check compares against zero after leave. */
export interface RegionalViewCensus {
  readonly bodies: number; readonly colliders: number; readonly pieces: number; readonly objects: number;
  readonly movers: number; readonly platforms: number; readonly bound: boolean; readonly visible: boolean; readonly held: boolean;
}

export interface RegionalView {
  readonly scope: Scope;
  /** Frame-local content parent, already in the page scene at the cell's render offset. */
  readonly root: Group;
  readonly registry: WorldRegistry;
  /** The region's player frame: admitted ground and water plus registered floors. */
  readonly queries: PlayerFrameQueries;
  /** Bind construction registry verbs without showing the destination or covering its coarse tiles. */
  prepare: (owner: Scope) => void;
  /** Show the parked root and route the page registry verbs here while `entry` (an entered runtime scope) lives. */
  enter: (entry: Scope) => void;
  /** Pose moving pieces (also run from `fixedPre` when supplied). */
  sync: () => void;
  census: () => RegionalViewCensus;
  dispose: () => void;
}

type Floor = NonNullable<Piece['floor']>;
const isScene = (object: Object3D): object is Scene => object instanceof Scene;

/** Build a cell's world view on admission; dispose it on leave or eviction. */
export function createRegionalView(request: RegionalViewRequest): RegionalView {
  const { cell, physics, slot, assets, allocator, claim } = request;
  if (request.scope.disposed) throw new Error('Regional view requires a live resident scope');
  const entry = allocator.entries().find((row) => row.id === claim.id);
  if (entry === undefined || entry.owner !== cell.instance) throw new Error('Regional view requires its reserved whole-runtime claim');
  const scope = request.scope.child(`grid.view:${cell.instance}`);
  const root = new Group(); ownSceneTree(root, scope, assets); root.name = `region:${cell.instance}`;
  // Parked geometry stays hidden: an inactive neighbour shows only its shardfile / frozen declared content.
  root.visible = false;
  root.position.set(cell.origin.x - request.home.x, 0, cell.origin.z - request.home.z);
  const registry = new WorldRegistry();
  registry.frame = root; // SF63: what this region places culls against the camera seen from its root (FrameCamera)
  registry.scope = scope; // SF57: an ambient registration belongs to this view, never to the page
  const movers = new Set<() => void>(), platforms: Floor[] = [];
  const objects = new Map<Object3D, { scope: Scope; refs: number }>();
  let bindings = 0, visibleBindings = 0, held = false;
  // Unwinds last (LIFO): the scene node, then the claim hold, after every piece scope below has released its handles.
  scope.onDispose(() => {
    registry.retire(); // SF57: what `place` recorded and the cullers it started for this region go with it
    registry.pieces.length = 0; registry.picks.length = 0; registry.sets.length = 0;
    movers.clear(); platforms.length = 0;
  });
  const prepare = request.prepare;
  const containment = cellClip(root, CHUNK_HALF, scope, prepare === undefined ? {} : { prepare: (node) => prepare(node, root) }); containment.sweep();
  request.scene.add(root);
  // The neutral road has the page sun/fill, no regional point lights or cell PMREM. Prepare those exact keys before leaving.
  if (isScene(request.scene)) registerExteriorLighting(request.scene, scope, root, null);
  root.updateMatrixWorld(true);
  // G639 / G669 frame floor: the root and every piece that is not a mover leave the
  // per-frame matrix walk; a node that moves after all is caught by its check (run with the movers) and returns to it
  const checks = new Set<() => void>();
  const checked = (owner: Scope) => (check: () => void): void => { checks.add(check); owner.onDispose(() => { checks.delete(check); }); };
  holdStaticMatrices(root, scope, checked(scope), { subtree: false });
  const sync = (): void => { if (scope.disposed) return; for (const move of movers) move(); for (const check of checks) check(); };
  if (request.fixedPre !== undefined) scope.onDispose(request.fixedPre(sync));

  withOwner(scope, () => {
    registry.onAdd((piece) => {
      if (scope.disposed) throw new Error('Regional view left before registration');
      // Each piece owns its native handles in a child of the view; its registering owner can release it earlier.
      const pieceScope = scope.child(`grid.piece:${piece.id}`), owner = enteredOwner();
      if (owner !== null && owner !== scope && !owner.disposed) {
        const forget = owner.captureScope(pieceScope); // G598: in steps when its owner retires in steps
        pieceScope.onDispose(forget);
      }
      withOwner(pieceScope, () => {
        const object = piece.object;
        if (object !== undefined) {
          let owned = objects.get(object);
          if (owned === undefined) {
            const objectScope = scope.child(`grid.object:${piece.id}`);
            owned = { scope: objectScope, refs: 0 }; objects.set(object, owned);
            root.add(object); ownSceneTree(object, objectScope, assets);
            objectScope.onDispose(() => { objects.delete(object); });
          }
          const placement = owned; placement.refs++;
          pieceScope.onDispose(() => { placement.refs--; if (placement.refs === 0) placement.scope.dispose(); });
        }
        const added = addPiece(physics, piece, root);
        if (added.body !== null || piece.active !== undefined) {
          movers.add(added.sync); pieceScope.onDispose(() => { movers.delete(added.sync); });
        } else if (object !== undefined && objects.get(object)?.refs === 1) {
          const placement = objects.get(object); if (placement !== undefined) holdStaticMatrices(object, placement.scope, checked(placement.scope));
        }
        const floor = piece.floor;
        if (floor !== undefined && piece.solidFloor !== true) {
          platforms.push(floor);
          pieceScope.onDispose(() => { const i = platforms.indexOf(floor); if (i !== -1) platforms.splice(i, 1); });
        }
        pieceScope.onDispose(() => { const i = registry.pieces.indexOf(piece); if (i !== -1) registry.pieces.splice(i, 1); });
      });
    });
  });

  const queries: PlayerFrameQueries = { heightAt: request.ground.heightAt, waterSurfaceAt: request.ground.waterSurfaceAt, platforms };
  const bind = (owner: Scope, present: boolean): void => {
    if (scope.disposed || owner.disposed) throw new Error('Regional registry requires a live view and entry');
    const unhold = claim.hold(); held = true;
    const prior = slot.registryValue;
    if (prior === registry) { unhold(); throw new Error('Regional registry is already entered'); }
    slot.registryValue = registry; bindings++; if (present) visibleBindings++;
    root.visible = visibleBindings > 0;
    // G223: the cell's coarse cover (far proxy, ring tiles) hands over to this root while the entry lives
    const uncover = present ? cellCoverOf(request.scene)?.cover(cell.instance, request.ownGround === true) ?? ((): void => undefined) : (): void => undefined;
    let restored = false;
    let forgetEntry = (): void => undefined, forgetView = (): void => undefined;
    const restore = (): void => {
      if (restored) return; restored = true; forgetEntry(); forgetView(); bindings--; unhold(); uncover(); held = bindings > 0;
      if (present) visibleBindings--;
      root.visible = visibleBindings > 0;
      if (slot.registryValue === registry) slot.registryValue = prior;
    };
    forgetEntry = owner.capture('disposers', restore);
    // A view disposed before its entry still hands the page its previous registry back.
    forgetView = scope.capture('disposers', restore);
  };
  return {
    scope, root, registry, queries, enter: owner => { bind(owner, true); containment.update(); }, prepare: owner => { bind(owner, false); }, sync,
    census: () => {
      const native = physics.scopedCensus(scope);
      return { bodies: native.bodies, colliders: native.colliders, pieces: registry.pieces.length, objects: root.children.length,
        movers: movers.size, platforms: platforms.length, bound: bindings > 0, visible: root.visible, held };
    },
    dispose: () => { scope.dispose(); },
  };
}
