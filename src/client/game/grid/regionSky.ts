/**
 * A live grid region's own sky inside its cell (SHARD-PLATFORM G223; the only path since Jake's G232 pick, SF63). A region whose level's look declares a sky backdrop (a day
 * clock driving a key dome, a PMREM environment and the lights, fog and haze: `LookStrategy.backdrop`) has that backdrop
 * built a second time on the page's ONE sky rig as a layer (`SkyRig.layerBackdrop`, `backdropLayer.ts`): its own targets,
 * its dome drawn over the page's sky, its clock blended into the shared light by its cell's owner weight from the one frame
 * (1 inside the cell, blended across the 16 m edge band, 0 on the road, where nothing of it is run or drawn). Its fog
 * colour goes to the region's own fog object, which the frame already reads as the owner's air (`frameLook.ts`).
 *
 * Memory, charged honestly: once built, the backdrop's ceiling (its resident key cap at the decoded size, the environment
 * equirect and PMREM's cube-UV targets: `SkyBackdrop.gpuCeiling`) is reserved through the page allocator under the
 * region's owner (`sim-sky:<instance>`, needed while resident); a refusal disposes it and the grid sky stays.
 * A reviewed matched runtime increment already contains its own sky: the exact child claim stays visible as a page
 * component covered by that instance's measured sim lease, with no engine-base credit. If that parent ends first, the
 * sky is independently charged again. Estimates and other instances cannot provide this coverage.
 * The build itself runs before the claim (the ceiling is only known once the first keys decode). Everything is freed with
 * the region's resident scope: the frame weight, the layer (its dome leaves the page scene, the rig puts every shared
 * value back), the backdrop's textures and targets (`SkyBackdrop.dispose`), then the claim.
 *
 * The level's grade chain (its LUT, curve and vibrance with the rest) is the frame's (`frame.ts`, G232): the drawn backdrop's
 * LUT is the one the region hands it, and its clock's saturation drives the page's where the page carries it. Generic game code
 * (E405): no shard is named here; the regional world closes over the page sky, renderer and level (`regionalWorld.ts`).
 */
import type { ResidencyAllocator, ResidencyLease } from '../../../shared/game/grid/allocator';
import type { FrameLookPort } from './frameLook';

/** What the layer needs of a built backdrop: its dispose and its byte census (`SkyBackdrop`'s G223 members). */
export interface RegionBackdrop { readonly dispose?: () => void; readonly gpuBytes?: () => number; readonly gpuCeiling?: () => number }
/** The page sky's layer for it (`SkyRig.layerBackdrop` → `BackdropLayer`). */
export interface RegionSkyLayer<B extends RegionBackdrop> {
  readonly attach: (backdrop: B) => void;
  weight: number;
  readonly state: () => { readonly weight: number; readonly drawn: boolean; readonly bytes: number };
  readonly dispose: () => void;
}

/** What a region's sky is built from. */
export interface RegionSkyRequest<B extends RegionBackdrop> {
  readonly instance: string;
  /**
   * the level's backdrop built as a layer on the page's one sky (`SkyRig.layeredBackdrop`); null when the level's look has
   * no backdrop or the page sky cannot take one
   */
  readonly layered: () => Promise<{ readonly layer: RegionSkyLayer<B>; readonly backdrop: B;
    /** Final attached-material preparation before visible frame weight can reach the layer. */
    readonly prepare?: () => Promise<void> } | null>;
  readonly look: FrameLookPort | null;
  readonly allocator: Pick<ResidencyAllocator, 'reserve' | 'entries'>;
  /** Exact sky bytes already present in this instance's reviewed runtime increment; never another region or an estimate. */
  readonly coveredBy?: string;
  /** the region's resident scope: the sky leaves with it */
  readonly scope: { readonly disposed: boolean; readonly onDispose: (fn: () => void) => void };
}

/** Why a region drew no sky of its own ('off': its level has no backdrop; the readout and tests); 'drawn' when it did. */
export type RegionSkyOutcome = 'off' | 'no-frame' | 'left' | 'refused' | 'failed' | 'drawn';

/** The allocator id a region's sky is charged under. */
export const regionSkyClaimId = (instance: string): string => `sim-sky:${instance}`;

/** Build the region's own sky as a layer on the page's one sky, if its level has a backdrop. */
export async function buildRegionSky<B extends RegionBackdrop>(request: RegionSkyRequest<B>): Promise<RegionSkyOutcome> {
  const { instance, scope } = request, left = (): boolean => scope.disposed;
  if (request.coveredBy !== undefined) {
    const parent = request.allocator.entries().find(row => row.id === request.coveredBy);
    if (request.coveredBy !== `sim:${instance}` || parent?.owner !== instance || parent.category !== 'sim') {
      throw new Error('Region sky coverage requires its own live runtime');
    }
  }
  const hang = request.look?.sky;
  if (hang === undefined) return 'no-frame';
  if (left()) return 'left';
  let built: Awaited<ReturnType<RegionSkyRequest<B>['layered']>>;
  try {
    built = await request.layered();
  } catch (error) {
    console.warn(`[region sky] ${instance}: its backdrop did not build`, error);
    return 'failed';
  }
  if (built === null) return 'off';
  const { layer, backdrop } = built;
  if (left()) { backdrop.dispose?.(); layer.dispose(); return 'left'; }
  const reserved = Math.ceil(backdrop.gpuCeiling?.() ?? backdrop.gpuBytes?.() ?? 0);
  let lease: ResidencyLease | null;
  try {
    lease = request.allocator.reserve({ id: regionSkyClaimId(instance), category: request.coveredBy === undefined ? 'sim' : 'page', owner: instance, bytes: reserved, distance: 0, needed: true,
      ...(request.coveredBy === undefined ? {} : { coveredBy: request.coveredBy }) });
  } catch (error) { backdrop.dispose?.(); layer.dispose(); throw error; }
  if (lease === null) { backdrop.dispose?.(); layer.dispose(); return 'refused'; }
  let release: (() => void) | null = null;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true; release?.(); layer.dispose(); lease.release();
  };
  scope.onDispose(dispose);
  try { layer.attach(backdrop); await built.prepare?.(); }
  catch (error) { dispose(); throw error; }
  if (left()) return 'left';
  release = hang(instance, {
    weight: (w) => { layer.weight = w; },
    state: () => { const s = layer.state(); return { weight: s.weight, drawn: s.drawn, bytes: s.bytes, reserved }; },
  });
  return 'drawn';
}
