import { ResidencyAllocator, type ResidencyLease } from '../../../shared/game/grid/allocator';
import type { App } from '@wildshard/engine/app/app';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Game } from '@wildshard/engine/core/Game';
import { AssetResidencyBridge, type AssetAllocationReader } from './assetResidency';
import { memoryAttribution } from '@wildshard/engine/core/memoryAttribution';

/** An admitted home claim, shared by the early boot and the later live registry without charging it twice. */
export interface HomeResidencyClaim {
  readonly instance: string;
  readonly bytes: number;
  readonly allocator: ResidencyAllocator;
  /** Acquire the registry's own lifetime reference. Release it when that registry disposes. */
  readonly retain: () => ResidencyLease;
  /** Transfer the sole boot reference once, after verifying the admitted whole runtime's exact cost.
   * Runtime callers supply regionalRuntimeAccountedBytes from the matching source and manifest; platform extras stay separate. */
  readonly handoff: (wholeRuntimeBytes: number) => ResidencyLease;
  /** Road-start recovery abandons only an unused sole boot reference, before allocating a different first region. */
  readonly releasePending: () => void;
}

/** The quality tier the page renders at (`@wildshard/engine/core/tier`), passed by the session so this owner reads no global. */
export type ComposerTier = 'phone' | 'desktop';
/** G226: the phone census's composer (colour + depth + fullscreen triangle) inside the measured 300 MB engine base. */
export const PHONE_COMPOSER_CALIBRATION = 13_140_636;
/** The bytes a composer allocation reserves on the page allocator, per tier's render-target budget (see `bindComposer`). */
export function composerReservation(bytes: number, tier: ComposerTier): number {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('Invalid composer allocation');
  return tier === 'phone' ? bytes : Math.min(bytes, PHONE_COMPOSER_CALIBRATION);
}

/**
 * SF18b / G144: construct before manifest hydration, then inject this allocator into the home loader and GridSession.
 * The composition root owns disposal, including failed or cancelled boots. Admission precedes world allocation; the
 * borrowed home remains needed for the page lifetime; an owned grid home takes the boot reference with handoff().
 * Trusted runtime homes supply reviewed resident-cost metadata rather than
 * the empty transitional shardfile's budget. This owner installs no service by import and creates no world or timer.
 */
export class PageResidency {
  readonly allocator: ResidencyAllocator;
  private claim: HomeResidencyClaim | undefined;
  private bootLease: ResidencyLease | undefined;
  private closed = false;
  private assetsBound = false;
  private composerBound = false;
  private wholePage = false;

  /** Renderer caches survive level unload, so their claims live with the actual renderer owner. */
  bindAssets(assets: App['assets'], rendererScope: Scope, homeScope: Scope | null, readOwner: () => Scope | null, readAllocations: AssetAllocationReader): void {
    if (this.assetsBound || this.closed || rendererScope.disposed) throw new Error('Page asset residency requires one live renderer');
    const bridge = new AssetResidencyBridge(this.allocator, readAllocations, readOwner);
    if (this.bootLease !== undefined && homeScope !== null) bridge.cover(homeScope, this.bootLease);
    let detach: () => void;
    try { detach = assets.bindResidency(bridge); }
    catch (error) { bridge.dispose(); throw error; }
    this.assetsBound = true;
    const stopAccounting = memoryAttribution.bindAccounting(() => this.allocator.cost().accounted);
    rendererScope.onDispose(() => { stopAccounting(); detach(); bridge.dispose(); });
  }

  /** Calibration: the 804×1362 phone census owns 8-byte colour + 4-byte depth + 60-byte fullscreen triangle = 13,140,636 bytes in the measured
   * 300 MB engine base (G226 full-loop receipt). Split that credit out; any larger current composer is additional.
   *
   * The reservation is sized to the tier's render-target budget (`composerReservation`): the page envelope (1.0 GB playing) is the
   * phone's, so a phone composer is charged at its actual allocation, while a desktop composer (sized to its drawing buffer and the
   * desktop look: 587 MB of targets at 2880×1800) is a property of that device, not of the content, and is charged at the phone
   * calibration. Without this a public desktop page was refused at boot by its own renderer, before any region loaded. */
  bindComposer(game: Pick<Game, 'observeComposerAllocation'>, rendererScope: Scope, tier: ComposerTier): void {
    if (this.composerBound || this.closed || rendererScope.disposed) throw new Error('Page composer requires one live renderer');
    // WebGLState creates one RGBA texel for 2D/array/3D and six cube faces: 36 bytes, until renderer retirement.
    // These are present in the same calibrated baseline, separately from the composer's render targets.
    const initialization = this.allocator.reservePageComponent('page:renderer-initialization', 36, 36);
    if (initialization === null) throw new Error('Renderer initialization admission deferred by the shared budget');
    let lease: ResidencyLease | null = null;
    const release = (): void => { lease?.release(); initialization.release(); };
    let detach: () => void;
    try {
      detach = game.observeComposerAllocation(bytes => {
        const reserved = composerReservation(bytes, tier);
        const next = this.allocator.reservePageComponent('page:composer', reserved, PHONE_COMPOSER_CALIBRATION, this.composerCover(reserved));
        if (next === null) throw new Error('Composer admission deferred by the shared budget');
        const previous = lease; lease = next; previous?.release();
      });
    } catch (error) { release(); throw error; }
    this.composerBound = true;
    rendererScope.onDispose(() => { detach(); release(); });
  }

  constructor(allocator: ResidencyAllocator = new ResidencyAllocator()) { this.allocator = allocator; }

  /** SF57: a measured whole-page home was read through this same composer, so it covers the composer while it lives, but
   * only while the composer still fits inside that reading beside what the home already covers (its retained commons).
   * A larger composer (a bigger drawing buffer than the census's) is charged uncovered, the same fallback the asset bridge
   * gives a retained cache that overflows the reading; covering it anyway threw at boot (Signal Dunes, 70 MB phone composer
   * against a 49 MB home). */
  private composerCover(bytes: number): string | undefined {
    const claim = this.claim;
    if (claim === undefined || !this.wholePage) return undefined;
    const id = `sim:${claim.instance}`, entries = this.allocator.entries(), home = entries.find(entry => entry.id === id);
    if (home === undefined) return undefined;
    const others = entries.reduce((sum, entry) => sum + (entry.id !== 'page:composer' && entry.coveredBy === id ? entry.bytes : 0), 0);
    return others + bytes <= home.bytes ? id : undefined;
  }

  /** The same policy follows early admission, the grid and every warning surface; never a second allocator. */
  get memory(): ResidencyAllocator['memory'] { return this.allocator.memory; }

  /** Reserve the home before any bootstrap allocation. Identical repeated admission shares its immutable identity.
   * `measuredPage`: the bytes are a reviewed whole-page reading (WebContent + GL minus the engine base, SF57), never a
   * declared budget; only such a home covers the page's composer. */
  admitHome(instance: string, bytes: number, measuredPage = false): HomeResidencyClaim {
    if (this.closed) throw new Error('Page residency is disposed');
    if (instance.length === 0 || !Number.isSafeInteger(bytes) || bytes <= 0) throw new RangeError('Home residency requires a positive measured or declared resident cost');
    if (this.claim !== undefined) {
      if (this.claim.instance !== instance || this.claim.bytes !== bytes || this.wholePage !== measuredPage) throw new Error('Page home residency changed identity or cost');
      return this.claim;
    }
    const id = `sim:${instance}`;
    if (this.allocator.has(id)) throw new Error('Home residency must be admitted by the page owner');
    const reserve = (): ResidencyLease => {
      if (this.closed) throw new Error('Page residency is disposed');
      const lease = this.allocator.reserve({ id, category: 'sim', owner: instance, bytes, distance: 0, needed: true });
      if (lease === null) throw new Error('Home residency admission deferred by the shared budget');
      return lease;
    };
    this.bootLease = reserve();
    if (measuredPage) { this.allocator.markMeasuredPage(id); this.wholePage = true; }
    let handedOff = false, releasedPending = false;
    const retain = (): ResidencyLease => {
      if (handedOff) throw new Error('Home residency has been handed off');
      if (releasedPending) throw new Error('Home residency preclaim has been released');
      return reserve();
    };
    const handoff = (wholeRuntimeBytes: number): ResidencyLease => {
      if (this.closed) throw new Error('Page residency is disposed');
      if (releasedPending) throw new Error('Home residency preclaim has been released');
      const lease = this.bootLease;
      if (handedOff || lease === undefined) throw new Error('Home residency has already been handed off');
      if (wholeRuntimeBytes !== bytes) throw new Error('Home residency differs from the admitted whole-runtime cost');
      const entry = this.allocator.entries().find((row) => row.id === id);
      if (entry?.refs !== 1) throw new Error('Home residency handoff requires its sole boot reference');
      handedOff = true; this.bootLease = undefined;
      return lease;
    };
    const releasePending = (): void => {
      if (this.closed) throw new Error('Page residency is disposed');
      if (handedOff) throw new Error('Cannot release a handed-off home runtime');
      if (releasedPending) return;
      const entry = this.allocator.entries().find(row => row.id === id);
      if (entry?.refs !== 1) throw new Error('Home preclaim release requires its sole boot reference');
      this.bootLease?.release(); this.bootLease = undefined; releasedPending = true;
    };
    this.claim = Object.freeze({ instance, bytes, allocator: this.allocator, retain, handoff, releasePending });
    return this.claim;
  }

  /** Read the already admitted claim; the live registry cannot create its first claim after the home allocated. */
  home(): HomeResidencyClaim {
    if (this.closed) throw new Error('Page residency is disposed');
    if (this.claim === undefined) throw new Error('Home residency has not been admitted');
    return this.claim;
  }

  /** Release the boot reference once. Existing registry references continue accounting until their own disposal. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.bootLease?.release();
    this.bootLease = undefined;
  }
}
