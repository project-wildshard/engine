import { ResidencyAllocator, type ResidencyLease } from '../../../shared/game/grid/allocator';
import type { App } from '@wildshard/engine/app/app';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Game } from '@wildshard/engine/core/Game';
import { AssetResidencyBridge, type AssetAllocationReader } from './assetResidency';
import { memoryAttribution } from '@wildshard/engine/core/memoryAttribution';

/** One reviewed reading of a home's whole cost: its bytes, and whether they are a measured whole page (SF57). */
export interface HomeReading { readonly bytes: number; readonly measuredPage: boolean }

/** An admitted home claim, shared by the early boot and the later live registry without charging it twice. */
export interface HomeResidencyClaim {
  readonly instance: string;
  /** The bytes the claim holds now: the boot's reading, or its images-first reading once the entry has settled on images. */
  readonly bytes: number;
  readonly allocator: ResidencyAllocator;
  /** Acquire the registry's own lifetime reference. Release it when that registry disposes. */
  readonly retain: () => ResidencyLease;
  /** Transfer the sole boot reference once, after verifying the admitted whole runtime's exact cost.
   * Runtime callers supply regionalRuntimeAccountedBytes from the matching source and manifest; platform extras stay separate.
   * The cost must be the boot's reading or the images-first reading admitted beside it (`admitHome`), nothing else. */
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
  /** What the boot admitted, for identical repeated admission (the claim's bytes may settle on images-first later). */
  private admitted: { readonly bytes: number; readonly measuredPage: boolean; readonly imagesFirst?: HomeReading } | undefined;
  /** The boot lease covers a borrowed home's asset scope (`bindAssets`); such a lease is never re-priced. */
  private coversAssets = false;

  /** Renderer caches survive level unload, so their claims live with the actual renderer owner. */
  bindAssets(assets: App['assets'], rendererScope: Scope, homeScope: Scope | null, readOwner: () => Scope | null, readAllocations: AssetAllocationReader): void {
    if (this.assetsBound || this.closed || rendererScope.disposed) throw new Error('Page asset residency requires one live renderer');
    const bridge = new AssetResidencyBridge(this.allocator, readAllocations, readOwner);
    if (this.bootLease !== undefined && homeScope !== null) { bridge.cover(homeScope, this.bootLease); this.coversAssets = true; }
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
   * declared budget; only such a home covers the page's composer.
   *
   * `imagesFirst` (GC21, QA 11-12 row 53): the same home's reviewed images-first reading. The boot prices the home before the
   * page can resolve its texture mode (the boot catalogue and the KTX2 tables install later), so it holds the compressed
   * reading; the grid entry resolves the mode and charges the reading of what it will load. A desktop with no KTX2 set for
   * its tier loads images, so Nalati and Sky Reach handed off their images-first cost against a compressed claim and the
   * load stopped at finish. `handoff` settles the unused boot reference on this reading, through the ordinary allocator,
   * before transferring it; any other cost is still refused. */
  admitHome(instance: string, bytes: number, measuredPage = false, imagesFirst?: HomeReading): HomeResidencyClaim {
    if (this.closed) throw new Error('Page residency is disposed');
    if (instance.length === 0 || !Number.isSafeInteger(bytes) || bytes <= 0) throw new RangeError('Home residency requires a positive measured or declared resident cost');
    if (imagesFirst !== undefined && (!Number.isSafeInteger(imagesFirst.bytes) || imagesFirst.bytes <= 0)) throw new RangeError('Home images-first reading requires a positive resident cost');
    if (this.claim !== undefined) {
      const was = this.admitted;
      if (this.claim.instance !== instance || was?.bytes !== bytes || was.measuredPage !== measuredPage
        || was.imagesFirst?.bytes !== imagesFirst?.bytes || was.imagesFirst?.measuredPage !== imagesFirst?.measuredPage) throw new Error('Page home residency changed identity or cost');
      return this.claim;
    }
    const id = `sim:${instance}`;
    if (this.allocator.has(id)) throw new Error('Home residency must be admitted by the page owner');
    let reading: HomeReading = { bytes, measuredPage };
    const reserve = (): ResidencyLease => {
      if (this.closed) throw new Error('Page residency is disposed');
      const lease = this.allocator.reserve({ id, category: 'sim', owner: instance, bytes: reading.bytes, distance: 0, needed: true });
      if (lease === null) throw new Error('Home residency admission deferred by the shared budget');
      return lease;
    };
    const hold = (next: HomeReading): void => {
      reading = next; this.bootLease = reserve(); this.wholePage = false;
      if (next.measuredPage) { this.allocator.markMeasuredPage(id); this.wholePage = true; }
    };
    hold(reading);
    this.admitted = { bytes, measuredPage, ...(imagesFirst === undefined ? {} : { imagesFirst }) };
    let handedOff = false, releasedPending = false, lost = false;
    /** Re-price the unused sole boot reference at the images-first reading, through the ordinary allocator. Nothing has
     * allocated under it yet: an owned grid home's assets are not covered by it (`bindAssets` gets no home scope) and no
     * page component is covered by it; either refuses the settle. That holds while every shard with an images-first reading
     * boots on a matched increment (a resident base, so never a whole page that covers the composer); a whole-page boot
     * reading with an images-first one would be refused here. A refused reservation restores the boot reading. */
    const settle = (next: HomeReading): void => {
      const entry = this.allocator.entries().find(row => row.id === id);
      if (entry?.refs !== 1) throw new Error('Home residency handoff requires its sole boot reference');
      if (this.coversAssets || this.allocator.entries().some(row => row.coveredBy === id)) throw new Error('Home residency settle requires an unused boot reference');
      const previous = reading;
      this.bootLease?.release(); this.bootLease = undefined;
      try { hold(next); } catch (error) {
        try { hold(previous); } catch (restore) { lost = true; throw new AggregateError([error, restore], 'Home residency settle and its restore were refused', { cause: restore }); }
        throw error;
      }
    };
    const retain = (): ResidencyLease => {
      if (handedOff) throw new Error('Home residency has been handed off');
      if (releasedPending) throw new Error('Home residency preclaim has been released');
      return reserve();
    };
    const handoff = (wholeRuntimeBytes: number): ResidencyLease => {
      if (this.closed) throw new Error('Page residency is disposed');
      if (releasedPending) throw new Error('Home residency preclaim has been released');
      if (lost) throw new Error('Home residency was lost by a refused images-first settle');
      const lease = this.bootLease;
      if (handedOff || lease === undefined) throw new Error('Home residency has already been handed off');
      if (wholeRuntimeBytes !== reading.bytes) {
        if (imagesFirst === undefined || wholeRuntimeBytes !== imagesFirst.bytes) throw new Error('Home residency differs from the admitted whole-runtime cost');
        settle(imagesFirst);
      }
      const entry = this.allocator.entries().find((row) => row.id === id), settled = this.bootLease;
      if (entry?.refs !== 1 || settled === undefined) throw new Error('Home residency handoff requires its sole boot reference');
      handedOff = true; this.bootLease = undefined;
      return settled;
    };
    const releasePending = (): void => {
      if (this.closed) throw new Error('Page residency is disposed');
      if (handedOff) throw new Error('Cannot release a handed-off home runtime');
      if (releasedPending) return;
      if (lost) { releasedPending = true; return; } // nothing is held: a refused settle already released it
      const entry = this.allocator.entries().find(row => row.id === id);
      if (entry?.refs !== 1) throw new Error('Home preclaim release requires its sole boot reference');
      this.bootLease?.release(); this.bootLease = undefined; releasedPending = true;
    };
    this.claim = Object.freeze({ instance, get bytes(): number { return reading.bytes; }, allocator: this.allocator, retain, handoff, releasePending });
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
