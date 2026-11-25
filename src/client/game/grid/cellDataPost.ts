/**
 * QA 11-24 row 69: a grid data cell's declared post look. Row 59 lays a data zone's declared post look (its level manifest's
 * `bindings.render`: Nine Dragon's rain, ink lines, wash and live frame channels) over its data look on its own shardfile
 * page; a grid data cell drew only its data sky (`hangCellDataSky`), so in the grid Nine had none of it. Here the cell builds
 * the same post look and runs its cell composite (`LookCellComposite`, a post-graph look's `cell`) the way a runtime cell
 * runs its level look's (`regionalWorld.ts`, op-frame21): its chain is contributed to the frame for its instance, so it
 * carries the frame by its cell's owner weight, and its composite draws the cell's root. Its programs compile first
 * (`prepareWorld`) and its frame hook (the drawing buffer's pixel terms, its channels and lent textures) runs every frame
 * while it is resident: without it the composite drew a black street. Everything is freed with the region's resident
 * scope. Generic game code (E405).
 */
import type { Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { prepareWorldLook, type LookCellComposite, type LookCellContext, type LookStrategy, type WorldLookContext } from '@wildshard/engine/render/look';
import { TIER, TIER_CONFIG } from '@wildshard/engine/core/tier';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { findShard } from '../shard/registry';
import { toLevelSpec } from '../shard/spec';
import { declaredLevel, withoutHorizon } from '../shardfile/declaredLook';
import { declaredPost, declaredPostLook } from '../shardfile/declaredRender';
import { frameLookOf, lookChainKind, regionChain, regionGrade, replacedKnobs, wholeChainKnobs, type FrameLookContribution, type FrameLookPort } from './frameLook';
import type { RegionalRuntimePage } from './regionalRuntime';

/** What a data cell's declared post look is built from (`hangCellDataPost`). */
export interface CellDataPostRequest {
  readonly instance: string;
  readonly slug: string;
  /** the admitted source: its manifest's render binding and its look section */
  readonly source: Pick<Shardfile, 'manifest' | 'look'>;
  /** the cell's admitted product, which holds the post graph's file */
  readonly folder: () => Pick<ShardFolder, 'slug' | 'shardfile' | 'json' | 'file'>;
  /** the cell's view root (`grid-cell:<instance>`): what its composite draws */
  readonly root: Object3D | undefined;
  /** the page's staged services; null before they exist: no post */
  readonly page: RegionalRuntimePage | null;
  /** the region's resident scope: the post leaves with it */
  readonly scope: Scope;
}

/** Where a cell's post look is laid: the grid frame's port, the page's camera, renderer and sky, and its systems. */
export interface CellPostHost {
  readonly port: FrameLookPort;
  readonly camera: LookCellContext['camera'];
  readonly renderer: WorldLookContext['renderer'];
  readonly sky: WorldLookContext['sky'];
  readonly addSystem: (system: { readonly id: string; readonly phase: 'update'; readonly run: (dt: number, t: number) => void }, scope: Scope) => void;
}

/** Lay a data cell's declared post look on the grid frame: 'off' when it declares none or the page has no grid frame. */
export async function hangCellDataPost(request: CellDataPostRequest): Promise<'on' | 'off'> {
  const { page, scope, root } = request, post = declaredPost(request.source), manifest = findShard(request.slug);
  if (post === null || page === null || manifest === undefined || root === undefined) return 'off';
  const game = page.world.game, port = frameLookOf(game.rootScene);
  if (port === null || port.composite === undefined) return 'off';
  const look = await declaredPostLook(post, request.folder());
  // FORMAT-PRUNE FP47b: the cell's own level look (`look.level`) over its discovery's (`declaredLevel`), as its sky reads it
  const level = toLevelSpec({ ...withoutHorizon(manifest), ...declaredLevel(manifest, { look: request.source.look }) });
  const ao = level.tiers?.[TIER]?.ao ?? TIER_CONFIG.ao;
  // a composite that is its whole colour chain carries a neutral engine chain beside it, as a runtime cell's does
  const frameLook = (cell: LookCellComposite): FrameLookContribution => ({ grade: regionGrade(level), chain: cell.replaces === 'chain'
    ? regionChain(level, () => null, undefined, { ao }, wholeChainKnobs(ao))
    : regionChain(level, () => null, lookChainKind(look), { ao, godRays: level.tiers?.[TIER]?.godRays }, replacedKnobs(look, TIER)) });
  const app = page.context.app;
  return layCellPost(look, frameLook, { instance: request.instance, root, scope },
    { port, camera: game.camera, renderer: game.renderer, sky: page.world.sky, addSystem: (system, owner) => { app.addSystem(system, owner); } });
}

/**
 * A built post look laid on one cell: its programs compile, its chain (`frameLook`) is contributed for the instance, its
 * cell composite draws `root` and its frame hook runs every update; all of it, and the look, leave with `scope`. 'off'
 * (the look freed) when the cell left first or the look has no cell composite.
 */
export async function layCellPost(look: LookStrategy, frameLook: (cell: LookCellComposite) => FrameLookContribution,
  target: { readonly instance: string; readonly root: Object3D; readonly scope: Scope }, host: CellPostHost): Promise<'on' | 'off'> {
  const { instance, root, scope } = target, cell = look.cell, composite = host.port.composite;
  if (scope.disposed || cell === undefined || composite === undefined) { look.dispose?.(); return 'off'; }
  scope.onDispose(() => { look.dispose?.(); });
  // a cell that leaves while its programs compile is no failure: the look already left with it
  try { await prepareWorldLook(look, { renderer: host.renderer, sky: host.sky, scope }); } catch (error) { if (scope.disposed) return 'off'; throw error; }
  if (scope.disposed) return 'off';
  scope.onDispose(host.port.contribute(instance, frameLook(cell)));
  scope.onDispose(composite(instance, cell.build({ root, camera: host.camera, renderer: host.renderer, tier: TIER, scope }), cell.replaces));
  const frame = look.frame;
  if (frame !== undefined) host.addSystem({ id: `grid.post.${instance}.frame`, phase: 'update', run: (dt, t) => { frame(dt, t); } }, scope);
  return 'on';
}
