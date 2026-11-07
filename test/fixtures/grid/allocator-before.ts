// Differential oracle: allocator from 68cd273ea, before indexed accounting.
/**
 * The one residency allocator (SHARD-PLATFORM SF18b, A18): every resident thing the grid keeps (render tiles and far
 * proxies, shard libraries, the commons, whole sims) is charged here through the SF22a cost model
 * (`@wildshard/engine/core/contentCost`) against the §3.2 playing envelope. Owners: the render rings reserve `l0` / `l1` /
 * `far`, the grid simulation registry reserves `sim:`, the shardfile loader reserves `library:` and `commons:`.
 *
 * Admission is synchronous. A claim that does not fit evicts unneeded, unheld claims farthest-first (ties by id, so the
 * same drive evicts the same things) in two phases: each candidate's owner prepares its eviction (the fallible part, such
 * as a sim's durable checkpoint) until the prepared bytes cover the shortfall; then every prepared eviction commits (which
 * cannot fail). If they never cover it, every prepared eviction aborts, nothing is evicted and the claim is refused (the
 * caller keeps what it has: a coarse tile, a soft wall). `needed` claims are never even prepared. An id already held is
 * shared (refcount), so a dependency used by several shards is charged once. Node-safe: no rendering, no timers.
 */
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { contentCost, type ContentCostInput } from '@wildshard/format/contentCost';
import { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { shardCost } from '../../../src/shared/game/grid/allocator';

/** The cost model's categories; `library` and `sim` map onto its plural fields. */
/** `near`: G342's near-placeholder views, on their own residency line. */
export type ResidencyCategory = 'l0' | 'l1' | 'far' | 'near' | 'library' | 'sim' | 'commons' | 'product' | 'page';
/** One resident thing. `bytes` are its decoded + GPU resident bytes (MB = 10^6). */
export interface ResidencyClaim {
  readonly id: string; readonly category: ResidencyCategory; readonly bytes: number;
  /** stable instance id, or `platform` */
  readonly owner: string;
  /** metres from the camera: eviction order, farthest first */
  readonly distance: number;
  /** the readiness model needs it now: never evicted */
  readonly needed: boolean;
  /** Shared bytes already included in this live whole-runtime claim (a retained commons cache, or a page component inside a
   * measured whole-page home). Retirement makes them independently charged. */
  readonly coveredBy?: string;
  /**
   * Two-phase eviction for claims with durability (sims): prepare does the fallible part and returns null when the claim
   * cannot go now; `commit` disposes it and must not fail; `abort` undoes the prepare and keeps it resident.
   */
  readonly prepareEvict?: () => ResidencyEviction | null;
  /** One-phase eviction, allowed only for claims with no durability (render tiles, proxies): disposes, never fails. */
  readonly evictSync?: () => void;
}
/** A prepared eviction: commit disposes the claim (infallible), abort keeps it. */
export interface ResidencyEviction { commit: () => void; abort: () => void }
/** A holder's handle on a claim. The last release frees the bytes. */
export interface ResidencyLease {
  readonly id: string;
  /** refresh the eviction inputs; the first holder's eviction callbacks stay */
  update: (patch: { distance?: number; needed?: boolean; coveredBy?: string | null }) => void;
  /** protect the claim from eviction while a dependant (a fine child, an in-flight request) uses it; returns the unhold */
  hold: () => () => void;
  release: () => void;
}
/** A frozen row of the allocator's table, for traces and readouts. */
export interface ResidencyEntry { readonly id: string; readonly category: ResidencyCategory; readonly bytes: number; readonly owner: string; readonly distance: number; readonly needed: boolean; readonly refs: number; readonly holds: number; readonly accountedBytes: number; readonly coveredBy?: string }
interface Entry { id: string; category: ResidencyCategory; bytes: number; owner: string; distance: number; needed: boolean; prepare: (() => ResidencyEviction | null) | undefined; refs: number; holds: number; generation: number; coveredBy: string | undefined; baseCredit: number }

const field = { l0: 'l0', l1: 'l1', far: 'far', near: 'near', library: 'libraries', sim: 'sims', commons: 'commons', product: 'products', page: 'page' } as const;

/** One allocator per grid session. `playing` defaults to the §3.2 envelope (1.0 GB, G65). */
export class ReferenceResidencyAllocator {
  /** G216: the page's trusted Developer policy; omitted callers retain strict admission. */
  readonly memory: MemoryAdmission;
  private readonly entries_ = new Map<string, Entry>();
  /** Sim claims whose bytes are a measured whole page or matched runtime increment, the only claims a page component may be covered by. */
  private readonly measured = new Set<string>();

  private readonly playing: number;
  private generation = 0;
  private evicting = false;
  constructor(options: { playing?: number; memory?: MemoryAdmission } = {}) {
    this.memory = options.memory ?? new MemoryAdmission();
    this.playing = options.playing ?? CONTENT_CAPS.playing;
    if (!Number.isFinite(this.playing) || this.playing <= 0) throw new RangeError('Invalid residency envelope');
  }

  /** Admit a claim, or share one already held under the same id; null when it cannot fit even after eviction. */
  reserve(claim: ResidencyClaim): ResidencyLease | null { return this.reserveClaim(claim, 0); }

  /** Split an evidenced renderer component out of the fixed engine baseline. Only the calibrated credit is removed;
   * larger current allocations increase the envelope, and the component remains a visible page-owned claim.
   * `coveredBy` names a measured whole-page home claim that already contains this component (SF57): while it lives, the
   * component charges nothing and returns its calibration credit, since that home's reading subtracted the same base. */
  reservePageComponent(id: string, bytes: number, calibratedCredit: number, coveredBy?: string): ResidencyLease | null {
    if (!Number.isSafeInteger(calibratedCredit) || calibratedCredit < 0 || calibratedCredit > CONTENT_CAPS.engineBase) throw new RangeError('Invalid engine calibration');
    const claim: ResidencyClaim & { baseCredit: number } = { id, category: 'page', bytes, owner: 'platform', needed: true, distance: 0, baseCredit: Math.min(bytes, calibratedCredit), ...(coveredBy === undefined ? {} : { coveredBy }) };
    const existing = this.entries_.get(id);
    if (existing === undefined) return this.reserveClaim(claim, claim.baseCredit);
    if (this.evicting || existing.category !== 'page' || !Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid page component replacement');
    this.validateCoverage(id, 'page', bytes, coveredBy);
    this.input(claim, new Set([id]));
    existing.bytes = bytes; existing.baseCredit = claim.baseCredit; existing.coveredBy = coveredBy; existing.refs++;
    return this.lease(existing);
  }

  private reserveClaim(claim: ResidencyClaim, baseCredit: number): ResidencyLease | null {
    if (claim.id.length === 0 || claim.owner.length === 0 || !Number.isSafeInteger(claim.bytes) || claim.bytes < 0 || !Number.isFinite(claim.distance) || claim.distance < 0) throw new RangeError('Invalid residency claim');
    if (claim.prepareEvict !== undefined && claim.evictSync !== undefined) throw new Error('A residency claim evicts in one phase or two, not both');
    if (this.evicting) throw new Error('Residency claims cannot be made from an evict callback');
    this.validateCoverage(claim.id, claim.category, claim.bytes, claim.coveredBy);
    const existing = this.entries_.get(claim.id);
    if (existing !== undefined) {
      if (existing.category !== claim.category || existing.bytes !== claim.bytes || existing.baseCredit !== baseCredit) throw new Error(`Residency claim ${claim.id} changed shape`);
      existing.refs++; existing.needed ||= claim.needed; existing.distance = Math.min(existing.distance, claim.distance);
      return this.lease(existing);
    }
    const extra = { ...claim, baseCredit };
    if (!this.fits(extra)) {
      this.evicting = true;
      try {
        if (!this.evictFor(extra)) {
          const input = this.input(extra), cost = shardCost(this.ownerBytes(claim.owner) + (extra.category === 'page' ? 0 : this.effectiveBytes(extra)), input);
          if (!this.memory.accept({ stage: 'resident', owner: claim.owner, id: claim.id, claimedBytes: claim.bytes,
            accountedBytes: cost.accounted, playingBytes: cost.playing, loadingBytes: cost.loading,
            playingCap: this.playing, categories: input })) return null;
        }
      } finally { this.evicting = false; }
    }
    const sync = claim.evictSync;
    const prepare = claim.prepareEvict ?? (sync === undefined ? undefined : (): ResidencyEviction => ({ commit: sync, abort: () => undefined }));
    const entry: Entry = { id: claim.id, category: claim.category, bytes: claim.bytes, owner: claim.owner, distance: claim.distance, needed: claim.needed, prepare, refs: 1, holds: 0, generation: ++this.generation, coveredBy: claim.coveredBy, baseCredit };
    this.entries_.set(entry.id, entry);
    return this.lease(entry);
  }

  /** The cost model over everything held now, decode / refinement overlap counted once. */
  cost(): { playing: number; loading: number; accounted: number; input: ContentCostInput } {
    const input = this.input(); return { ...contentCost(input), input };
  }

  /** The table in id order (deterministic traces). */
  entries(): readonly ResidencyEntry[] {
    return [...this.entries_.values()].sort((a, b) => a.id.localeCompare(b.id)).map((e) => Object.freeze({ id: e.id, category: e.category, bytes: e.bytes, owner: e.owner, distance: e.distance, needed: e.needed, refs: e.refs, holds: e.holds, accountedBytes: this.effectiveBytes(e), ...(e.coveredBy === undefined ? {} : { coveredBy: e.coveredBy }) }));
  }

  /** SF57 / G258: mark a live sim claim as a reviewed measured whole-page reading or matched pre-entry runtime
   * increment, so only page components actually inside that reading may be covered by it. Components subtracted as
   * part of the resident baseline stay independently charged. An estimated or declared claim is never marked. */
  markMeasuredPage(id: string): void {
    const entry = this.entries_.get(id);
    if (entry?.category !== 'sim' || entry.coveredBy !== undefined) throw new Error('Only a live sim claim can be a measured whole page');
    this.measured.add(id);
  }

  /** True while the id is resident (held by at least one lease). */
  has(id: string): boolean { return this.entries_.has(id); }

  private covered(entry: { coveredBy?: string | undefined }, omitted: ReadonlySet<string> = new Set()): boolean {
    return entry.coveredBy !== undefined && !omitted.has(entry.coveredBy) && this.entries_.has(entry.coveredBy);
  }
  private effectiveBytes(entry: { bytes: number; coveredBy?: string | undefined }, omitted: ReadonlySet<string> = new Set()): number {
    return this.covered(entry, omitted) ? 0 : entry.bytes;
  }
  private validateCoverage(id: string, category: ResidencyCategory, bytes: number, covering: string | undefined): void {
    if (covering === undefined) return;
    const parent = this.entries_.get(covering);
    // Only a measured whole runtime (a `sim` claim) can contain other bytes: retained commons, or page components (SF57).
    if ((category !== 'commons' && category !== 'page') || parent?.category !== 'sim' || parent.coveredBy !== undefined || id === covering) throw new Error('Invalid runtime cache coverage');
    if (category === 'page' && !this.measured.has(covering)) throw new Error('Page coverage requires a measured whole-page claim');
    const others = [...this.entries_.values()].filter(e => e.id !== id && e.coveredBy === covering).reduce((sum, e) => sum + e.bytes, 0);
    if (others + bytes > parent.bytes) throw new Error('Runtime cache coverage exceeds its measured bytes');
  }
  /** G556: one owner's accounted bytes, shared page components excluded. */
  private ownerBytes(owner: string): number {
    return [...this.entries_.values()].filter(e => e.owner === owner && e.category !== 'page').reduce((sum, e) => sum + this.effectiveBytes(e), 0);
  }
  private input(extra?: ResidencyClaim & { baseCredit: number }, omitted: ReadonlySet<string> = new Set()): ContentCostInput {
    const input: ContentCostInput = { l0: 0, l1: 0, far: 0, libraries: 0, sims: 0, commons: 0, products: 0, overlap: CONTENT_CAPS.overlap };
    let credit = 0, page = 0;
    for (const e of this.entries_.values()) {
      if (omitted.has(e.id)) continue;
      if (e.category === 'page') { if (!this.covered(e, omitted)) { page += e.bytes; credit += e.baseCredit; } }
      else { const key = field[e.category]; input[key] = (input[key] ?? 0) + this.effectiveBytes(e, omitted); }
    }
    if (extra !== undefined) {
      if (extra.category === 'page') { if (!this.covered(extra, omitted)) { page += extra.bytes; credit += extra.baseCredit; } }
      else { const key = field[extra.category]; input[key] = (input[key] ?? 0) + this.effectiveBytes(extra, omitted); }
    }
    if (credit > CONTENT_CAPS.engineBase) throw new Error('Page calibration exceeds the engine baseline');
    if (page > 0) { input.page = page; input.engineBase = CONTENT_CAPS.engineBase - credit; }
    return input;
  }
  private fits(extra: ResidencyClaim & { baseCredit: number }): boolean { return contentCost(this.input(extra)).playing <= this.playing; }
  /**
   * Prepare unneeded, unheld claims farthest-first until the prepared bytes make room; commit them all, or abort them all
   * and evict nothing. Returns whether the claim now fits.
   */
  private evictFor(extra: ResidencyClaim & { baseCredit: number }): boolean {
    const candidates = [...this.entries_.values()].filter((e) => !e.needed && e.holds === 0 && e.prepare !== undefined).sort((a, b) => b.distance - a.distance || a.id.localeCompare(b.id));
    const prepared: { entry: Entry; eviction: ResidencyEviction }[] = []; const omitted = new Set<string>(); let enough = false;
    for (const entry of candidates) {
      const eviction = entry.prepare?.() ?? null; if (eviction === null) continue;
      prepared.push({ entry, eviction }); omitted.add(entry.id);
      if (contentCost(this.input(extra, omitted)).playing <= this.playing) { enough = true; break; }
    }
    if (!enough) { for (const { eviction } of prepared.reverse()) eviction.abort(); return false; }
    for (const { entry, eviction } of prepared) { this.drop(entry); eviction.commit(); }
    return this.fits(extra);
  }
  private drop(entry: Entry): void {
    if (this.entries_.get(entry.id) !== entry) return;
    this.entries_.delete(entry.id); this.measured.delete(entry.id);
    // The table is already authoritative. Derive warning totals only when a resident report can consume them,
    // rather than re-walking every remaining cache allocation after each individual release.
    // Parent/page retirement can expose calibrated page coverage and must still validate that input immediately.
    if (this.memory.hasResidentWarnings || entry.category === 'sim' || entry.category === 'page')
      this.memory.syncResidents(new Set(this.entries_.keys()), owner => { const input = this.input(); return { ...shardCost(this.ownerBytes(owner), input), input }; });
  }
  private lease(entry: Entry): ResidencyLease {
    let released = false;
    const live = (): boolean => !released && this.entries_.get(entry.id) === entry;
    return Object.freeze({
      id: entry.id,
      update: (patch: { distance?: number; needed?: boolean; coveredBy?: string | null }): void => {
        if (!live()) return;
        if (patch.distance !== undefined) { if (!Number.isFinite(patch.distance) || patch.distance < 0) throw new RangeError('Invalid residency distance'); entry.distance = patch.distance; }
        if (patch.coveredBy !== undefined) {
          const covering = patch.coveredBy ?? undefined;
          this.validateCoverage(entry.id, entry.category, entry.bytes, covering);
          entry.coveredBy = covering;
        }
        if (patch.needed !== undefined) entry.needed = patch.needed;
      },
      hold: (): (() => void) => {
        if (!live()) return () => undefined;
        entry.holds++; let held = true;
        return () => { if (held) { held = false; entry.holds--; } };
      },
      release: (): void => {
        if (released) return; released = true;
        if (this.entries_.get(entry.id) !== entry) return;
        if (--entry.refs === 0) this.drop(entry);
      },
    });
  }
}
