/**
 * The one residency allocator (SHARD-PLATFORM SF18b, A18): every resident thing the grid keeps (render tiles and far
 * proxies, shard libraries, the commons, whole sims) is charged here through the SF22a cost model
 * (`@wildshard/engine/core/contentCost`) against the §3.2 playing envelope. Owners: the render rings reserve `l0` / `l1` /
 * `far`, the grid simulation registry reserves `sim:`, the shardfile loader reserves `library:` and `commons:`.
 *
 * Admission is synchronous. A claim that does not fit evicts unneeded, unheld claims farthest-first (ties by id, so the
 * same drive evicts the same things) in two phases: each candidate's owner prepares its eviction (the fallible part, such
 * as a sim's durable checkpoint) until the prepared bytes cover the shortfall; then every prepared eviction commits before
 * its claim is removed. A failed disposal keeps its charge and aborts the remaining preparations. If they never cover it,
 * every prepared eviction aborts and nothing is evicted. G556: the envelope is only
 * the eviction target; the limits are per shard, so the claim is then judged by its owner alone ({@link shardCost}) and
 * refused only when that owner is over them (the caller keeps what it has: a coarse tile, a soft wall). `needed` claims are never even prepared. An id already held is
 * shared (refcount), so a dependency used by several shards is charged once. Node-safe: no rendering, no timers.
 */
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { contentCost, type ContentCostInput } from '@wildshard/format/contentCost';
import { MemoryAdmission } from '@wildshard/format/memoryAdmission';

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
   * cannot go now; `commit` disposes it before its charge is removed; `abort` undoes the prepare and keeps it resident.
   */
  readonly prepareEvict?: () => ResidencyEviction | null;
  /** One-phase eviction, allowed only for claims with no durability (render tiles, proxies): disposes, never fails. */
  readonly evictSync?: () => void;
}
/** A prepared eviction: commit disposes before uncharging; a throw preserves the claim. Abort keeps it. */
export interface ResidencyEviction { commit: () => void; abort: () => void }
/** A holder's handle on a claim. The last release frees the bytes. */
export interface ResidencyLease {
  readonly id: string;
  /** Reduce an owned allocation after its buffers are released; growth requires ordinary admission. */
  shrink: (bytes: number) => void;
  /** refresh the eviction inputs; the first holder's eviction callbacks stay */
  update: (patch: { distance?: number; needed?: boolean; coveredBy?: string | null }) => void;
  /** protect the claim from eviction while a dependant (a fine child, an in-flight request) uses it; returns the unhold */
  hold: () => () => void;
  /** A sole holder may install fallible two-phase eviction after construction.
   * Implementations without this capability cannot retain a departed world. */
  evictWith?: (prepare: () => ResidencyEviction | null) => void;
  release: () => void;
}
/** A frozen row of the allocator's table, for traces and readouts. */
export interface ResidencyEntry { readonly id: string; readonly category: ResidencyCategory; readonly bytes: number; readonly owner: string; readonly distance: number; readonly needed: boolean; readonly refs: number; readonly holds: number; readonly accountedBytes: number; readonly coveredBy?: string }
interface Entry { id: string; category: ResidencyCategory; bytes: number; owner: string; distance: number; needed: boolean; prepare: (() => ResidencyEviction | null) | undefined; refs: number; holds: number; generation: number; coveredBy: string | undefined; baseCredit: number }
interface Coverage { bytes: number; commons: number; page: number; credit: number; children: Set<Entry> }

const field = { l0: 'l0', l1: 'l1', far: 'far', near: 'near', library: 'libraries', sim: 'sims', commons: 'commons', product: 'products', page: 'page' } as const;
/** every category but the page components, which carry calibration credit as well as bytes */
const CHARGED: readonly Exclude<ResidencyCategory, 'page'>[] = ['l0', 'l1', 'far', 'near', 'library', 'sim', 'commons', 'product'];

/** G556: one owner alone on the cost model (the page's engine base, shared renderer components and overlap, plus its own
 * accounted bytes at the resident factor). The playing / loading limits apply to this, never to the page total. */
export function shardCost(accounted: number, page: ContentCostInput): { playing: number; loading: number; accounted: number } {
  return contentCost({ l0: 0, l1: 0, far: 0, libraries: 0, sims: 0, commons: 0, products: accounted, overlap: page.overlap,
    page: page.page ?? 0, ...(page.engineBase === undefined ? {} : { engineBase: page.engineBase }) });
}

/** One allocator per grid session. `playing` defaults to the §3.2 envelope (1.0 GB, G65). */
export class ResidencyAllocator {
  /** G216: the page's trusted Developer policy; omitted callers retain strict admission. */
  readonly memory: MemoryAdmission;
  private readonly entries_ = new Map<string, Entry>();
  private orderedEntries: readonly Entry[] | null = null;
  private readonly entrySnapshots = new WeakMap<Entry, ResidencyEntry>();
  /** Sim claims whose bytes are a measured whole page or matched runtime increment, the only claims a page component may be covered by. */
  private readonly measured = new Set<string>();
  private readonly totals: Record<ResidencyCategory, number> = { l0: 0, l1: 0, far: 0, near: 0, library: 0, sim: 0, commons: 0, product: 0, page: 0 };
  private credit = 0;
  private accountingRevision = 0;
  private nearCount = 0;
  private readonly coverage = new Map<string, Coverage>();
  /** Each owner's accounted bytes (page components excluded, covered claims at 0), kept as claims and coverage change. */
  private readonly owners = new Map<string, number>();
  private readonly evictable = new Set<Entry>();
  private evictionOrder: Entry[] | null = null;
  /** claims that left `evictable` since `evictionOrder` was made (they keep the others' order: one filter drops them) */
  private evictionStale = 0;
  /** The evictable claims' charged bytes per category (and page calibration credit), kept with the evictable index: the
   *  most room evicting all of them could make, as an upper bound (a covered claim frees nothing, a parent's bytes ignore
   *  the children it re-exposes), so the bound refuses only claims eviction cannot fit. */
  private readonly evictableShares = new Map<Entry, { readonly category: ResidencyCategory; readonly bytes: number; readonly credit: number }>();
  private readonly evictableBytes: Record<ResidencyCategory, number> = { l0: 0, l1: 0, far: 0, near: 0, library: 0, sim: 0, commons: 0, product: 0, page: 0 };
  private evictableCredit = 0;

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
  /** Speculative IO may use existing headroom, never evict another owner's ready world. */
  reserveIfFits(claim: ResidencyClaim): ResidencyLease | null { return this.reserveClaim(claim, 0, false); }

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
    this.input(claim, new Set([id])); // validates the calibration; a shared page component is never refused on the page total (G556)
    this.track(existing, -1);
    existing.bytes = bytes; existing.baseCredit = claim.baseCredit; existing.coveredBy = coveredBy; existing.refs++;
    this.track(existing, 1); this.refreshEviction(existing);
    return this.lease(existing);
  }

  private reserveClaim(claim: ResidencyClaim, baseCredit: number, allowEviction = true): ResidencyLease | null {
    if (claim.id.length === 0 || claim.owner.length === 0 || !Number.isSafeInteger(claim.bytes) || claim.bytes < 0 || !Number.isFinite(claim.distance) || claim.distance < 0) throw new RangeError('Invalid residency claim');
    if (claim.prepareEvict !== undefined && claim.evictSync !== undefined) throw new Error('A residency claim evicts in one phase or two, not both');
    if (this.evicting) throw new Error('Residency claims cannot be made from an evict callback');
    this.validateCoverage(claim.id, claim.category, claim.bytes, claim.coveredBy);
    const existing = this.entries_.get(claim.id);
    if (existing !== undefined) {
      if (existing.category !== claim.category || existing.bytes !== claim.bytes || existing.baseCredit !== baseCredit) throw new Error(`Residency claim ${claim.id} changed shape`);
      existing.refs++; existing.needed ||= claim.needed; existing.distance = Math.min(existing.distance, claim.distance);
      this.refreshEviction(existing);
      return this.lease(existing);
    }
    const extra = { ...claim, baseCredit };
    if (!this.fits(extra)) {
      if (!allowEviction) return null;
      this.evicting = true;
      try {
        if (!this.evictFor(extra)) {
          const input = this.input(extra), cost = shardCost(this.ownerTotal(claim.owner) + (extra.category === 'page' ? 0 : this.effectiveBytes(extra)), input);
          if (!this.memory.accept({ stage: 'resident', owner: claim.owner, id: claim.id, claimedBytes: claim.bytes,
            accountedBytes: cost.accounted, playingBytes: cost.playing, loadingBytes: cost.loading,
            playingCap: this.playing, categories: input })) return null;
        }
      } finally { this.evicting = false; }
    }
    const sync = claim.evictSync;
    const prepare = claim.prepareEvict ?? (sync === undefined ? undefined : (): ResidencyEviction => ({ commit: sync, abort: () => undefined }));
    const entry: Entry = { id: claim.id, category: claim.category, bytes: claim.bytes, owner: claim.owner, distance: claim.distance, needed: claim.needed, prepare, refs: 1, holds: 0, generation: ++this.generation, coveredBy: claim.coveredBy, baseCredit };
    const children = this.coverage.get(entry.id);
    if (children !== undefined) this.adjustCoverage(children, -1);
    this.entries_.set(entry.id, entry); this.orderedEntries = null; this.track(entry, 1); this.refreshEviction(entry); this.reshare(children);
    return this.lease(entry);
  }

  /** One owner's accounted bytes, page components excluded and covered claims at zero: its running total.
   *  Re-scanning every claim here made over-budget registrations quadratic (Nine's grid entry: 300-480 ms frames at 4x CPU). */
  private ownerTotal(owner: string): number { return this.owners.get(owner) ?? 0; }
  private ownerAdd(owner: string, bytes: number): void {
    const total = (this.owners.get(owner) ?? 0) + bytes;
    if (total === 0) this.owners.delete(owner); else this.owners.set(owner, total);
  }
  /** Re-judge the retained resident warnings, each by its owner alone (G556). */
  private syncResidents(): void {
    const input = this.input(); // validates the page calibration even with no warning to re-judge
    if (!this.memory.hasResidentWarnings) return;
    this.memory.syncResidents(this.entries_, owner => ({ ...shardCost(this.ownerTotal(owner), input), input }));
  }

  /** Revision of charged costs, for deferred optional work; distances do not change it. */
  get revision(): number { return this.accountingRevision; }

  /** The cost model over everything held now, decode / refinement overlap counted once. */
  cost(): { playing: number; loading: number; accounted: number; input: ContentCostInput } {
    const input = this.input(); return { ...contentCost(input), input };
  }

  /** One owner's full playing envelope, including the calibrated shared page.
   * Retention uses this strict ruler even when ordinary admission only reports. */
  ownerCost(owner: string): ReturnType<typeof shardCost> { return shardCost(this.ownerTotal(owner), this.input()); }

  /** G723: read-only eligibility for speculative preparation beside a kept world.
   * Existing claims and page costs stay charged; the incoming sim adds its whole
   * admitted cost without assuming future coverage credit or eviction. Failure
   * defers this optimization, never changes ordinary G556 admission policy. */
  canPrepareAlongside(kept: string, incoming: string, bytes: number, limits: { readonly playing: number; readonly loading: number }): boolean {
    if (kept.length === 0 || incoming.length === 0 || kept === incoming
      || !Number.isSafeInteger(bytes) || bytes < 0 || !Number.isFinite(limits.playing) || limits.playing <= 0
      || !Number.isFinite(limits.loading) || limits.loading <= 0) return false;
    const input = this.input();
    return contentCost({ ...input, sims: input.sims + bytes }).loading <= limits.loading
      && shardCost(this.ownerTotal(kept), input).playing <= limits.playing
      && shardCost(this.ownerTotal(incoming) + bytes, input).playing <= limits.playing;
  }

  /** O14: every held claim's id, owner and bytes in admission order, unsorted and unsnapshotted: for per-tick totals (the
   * cell screens' claimed bytes) that `entries()` re-sorted and froze for every row while a cell's claims came and went. */
  claims(): IterableIterator<Readonly<Pick<ResidencyEntry, 'id' | 'owner' | 'bytes'>>> { return this.entries_.values(); }

  /** The table in id order (deterministic traces). Membership alone changes the order;
   * unchanged rows reuse their frozen snapshot, without retaining departed claims. */
  entries(): readonly ResidencyEntry[] {
    const ordered = this.orderedEntries ??= [...this.entries_.values()].sort((a, b) => a.id.localeCompare(b.id));
    const snapshots: ResidencyEntry[] = [];
    for (const entry of ordered) {
      const before = this.entrySnapshots.get(entry), accountedBytes = this.effectiveBytes(entry);
      if (before !== undefined && before.bytes === entry.bytes && before.distance === entry.distance
        && before.needed === entry.needed && before.refs === entry.refs && before.holds === entry.holds
        && before.coveredBy === entry.coveredBy && before.accountedBytes === accountedBytes) { snapshots.push(before); continue; }
      const snapshot = Object.freeze({ id: entry.id, category: entry.category, bytes: entry.bytes, owner: entry.owner,
        distance: entry.distance, needed: entry.needed, refs: entry.refs, holds: entry.holds, accountedBytes,
        ...(entry.coveredBy === undefined ? {} : { coveredBy: entry.coveredBy }) });
      this.entrySnapshots.set(entry, snapshot);
      snapshots.push(snapshot);
    }
    return snapshots;
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

  /** Remaining bytes of an existing sim's coverage, optionally replacing one child's allocation. */
  coverageRemaining(id: string, replacing?: string): number | null {
    const parent = this.entries_.get(id);
    if (parent?.category !== 'sim') return null;
    const previous = replacing === undefined ? undefined : this.entries_.get(replacing);
    return parent.bytes - (this.coverage.get(id)?.bytes ?? 0) + (previous?.coveredBy === id ? previous.bytes : 0);
  }

  private covered(entry: { coveredBy?: string | undefined }, omitted?: ReadonlySet<string>): boolean {
    return entry.coveredBy !== undefined && omitted?.has(entry.coveredBy) !== true && this.entries_.has(entry.coveredBy);
  }
  private effectiveBytes(entry: { bytes: number; coveredBy?: string | undefined }, omitted?: ReadonlySet<string>): number {
    return this.covered(entry, omitted) ? 0 : entry.bytes;
  }
  private validateCoverage(id: string, category: ResidencyCategory, bytes: number, covering: string | undefined): void {
    if (covering === undefined) return;
    const parent = this.entries_.get(covering);
    // Only a measured whole runtime (a `sim` claim) can contain other bytes: retained commons, or page components (SF57).
    if ((category !== 'commons' && category !== 'page') || parent?.category !== 'sim' || parent.coveredBy !== undefined || id === covering) throw new Error('Invalid runtime cache coverage');
    if (category === 'page' && !this.measured.has(covering)) throw new Error('Page coverage requires a measured whole-page claim');
    const remaining = this.coverageRemaining(covering, id);
    if (remaining === null || bytes > remaining) throw new Error('Runtime cache coverage exceeds its measured bytes');
  }
  private adjustCoverage(group: Coverage, sign: number): void {
    this.totals.commons += sign * group.commons; this.totals.page += sign * group.page; this.credit += sign * group.credit;
    for (const child of group.children) if (child.category !== 'page') this.ownerAdd(child.owner, sign * child.bytes);
  }
  private track(entry: Entry, sign: 1 | -1): void {
    this.accountingRevision++;
    if (!this.covered(entry)) {
      this.totals[entry.category] += sign * entry.bytes;
      if (entry.category === 'page') this.credit += sign * entry.baseCredit;
      else this.ownerAdd(entry.owner, sign * entry.bytes);
    }
    if (entry.category === 'near') this.nearCount += sign;
    const covering = entry.coveredBy;
    if (covering === undefined) return;
    let group = this.coverage.get(covering);
    if (group === undefined) { group = { bytes: 0, commons: 0, page: 0, credit: 0, children: new Set() }; this.coverage.set(covering, group); }
    if (sign === 1) group.children.add(entry); else group.children.delete(entry);
    group.bytes += sign * entry.bytes;
    if (entry.category === 'page') { group.page += sign * entry.bytes; group.credit += sign * entry.baseCredit; }
    else group.commons += sign * entry.bytes;
    if (group.children.size === 0) this.coverage.delete(covering);
  }
  private refreshEviction(entry: Entry): void {
    // Only eligible claims enter the sorted index; distance/needed/hold changes invalidate its snapshot.
    const eligible = this.entries_.get(entry.id) === entry && !entry.needed && entry.holds === 0 && entry.prepare !== undefined;
    if (eligible) { this.evictable.add(entry); this.evictionOrder = null; this.evictionStale = 0; }
    // a claim that leaves keeps the others' order: the next walk drops it rather than sorting every claim again (an
    // entry's over-budget registrations each evicted a few idle claims and re-sorted thousands: Nine's grid entry, 4x CPU)
    else if (this.evictable.delete(entry) && this.evictionOrder !== null) this.evictionStale++;
    this.share(entry, eligible);
  }
  /** An evictable claim's share of the bound: what evicting it can take off the ledger. A covered claim is charged
   *  nothing, so it frees nothing (with its parent, the parent's own share already counts its bytes): at Nine's entry
   *  idle covered caches let the raw-byte bound pass, so each registration over target prepared and aborted them all. */
  private share(entry: Entry, eligible: boolean): void {
    const before = this.evictableShares.get(entry);
    if (before !== undefined) { this.evictableBytes[before.category] -= before.bytes; this.evictableCredit -= before.credit; this.evictableShares.delete(entry); }
    if (!eligible) return;
    const covered = this.covered(entry);
    const share = { category: entry.category, bytes: covered ? 0 : entry.bytes, credit: entry.category === 'page' && !covered ? entry.baseCredit : 0 };
    this.evictableShares.set(entry, share); this.evictableBytes[share.category] += share.bytes; this.evictableCredit += share.credit;
  }
  /** A parent's arrival or departure changes whether its evictable children are charged. */
  private reshare(group: Coverage | undefined): void {
    if (group !== undefined) for (const child of group.children) if (this.evictableShares.has(child)) this.share(child, true);
  }
  private input(extra?: ResidencyClaim & { baseCredit: number }, omitted?: ReadonlySet<string>): ContentCostInput {
    const input: ContentCostInput = { l0: this.totals.l0, l1: this.totals.l1, far: this.totals.far, libraries: this.totals.library,
      sims: this.totals.sim, commons: this.totals.commons, products: this.totals.product, overlap: CONTENT_CAPS.overlap };
    let credit = this.credit, page = this.totals.page, near = this.totals.near, nearCount = this.nearCount;
    if (omitted !== undefined) for (const id of omitted) {
      const e = this.entries_.get(id);
      if (e === undefined) continue;
      if (e.category === 'near') nearCount--;
      if (!this.covered(e)) {
        if (e.category === 'page') { page -= e.bytes; credit -= e.baseCredit; }
        else if (e.category === 'near') near -= e.bytes;
        else { const key = field[e.category]; input[key] = (input[key] ?? 0) - e.bytes; }
      }
      // Removing a parent exposes only surviving children; omitted covered children contributed zero already.
      const group = this.coverage.get(id);
      if (group !== undefined) for (const child of group.children) if (!omitted.has(child.id)) {
        if (child.category === 'page') { page += child.bytes; credit += child.baseCredit; }
        else input.commons += child.bytes;
      }
    }
    if (extra !== undefined) {
      if (extra.category === 'page') { if (!this.covered(extra, omitted)) { page += extra.bytes; credit += extra.baseCredit; } }
      else if (extra.category === 'near') { nearCount++; near += extra.bytes; }
      else { const key = field[extra.category]; input[key] = (input[key] ?? 0) + this.effectiveBytes(extra, omitted); }
    }
    if (nearCount > 0) input.near = near;
    if (credit > CONTENT_CAPS.engineBase) throw new Error('Page calibration exceeds the engine baseline');
    if (page > 0) { input.page = page; input.engineBase = CONTENT_CAPS.engineBase - credit; }
    return input;
  }
  /** Advance the speculative ledger once per selected claim. Re-scanning every earlier omission here made
   * thousands of idle geometry allocations quadratic for each over-target registration. */
  private omit(input: ContentCostInput, entry: Entry, omitted: Set<string>, extra: ResidencyClaim & { baseCredit: number }): void {
    if (this.entries_.get(entry.id) !== entry) return;
    // a plain claim (not a page component, covering nothing, not the new claim's cover) moves one field
    if (entry.category !== 'page' && extra.coveredBy !== entry.id && !this.coverage.has(entry.id)) {
      if (!this.covered(entry, omitted)) { const key = field[entry.category]; input[key] = (input[key] ?? 0) - entry.bytes; }
      omitted.add(entry.id);
      return;
    }
    let page = input.page ?? 0, credit = CONTENT_CAPS.engineBase - (input.engineBase ?? CONTENT_CAPS.engineBase);
    const adjust = (row: Pick<Entry, 'category' | 'bytes' | 'baseCredit'>, sign: number): void => {
      if (row.category === 'page') { page += sign * row.bytes; credit += sign * row.baseCredit; }
      else { const key = field[row.category]; input[key] = (input[key] ?? 0) + sign * row.bytes; }
    };
    if (!this.covered(entry, omitted)) adjust(entry, -1);
    omitted.add(entry.id);
    // Only sim parents cover allocations; each surviving child is exposed once when its parent is omitted.
    const group = this.coverage.get(entry.id);
    if (group !== undefined) for (const child of group.children) if (!omitted.has(child.id)) adjust(child, 1);
    if (extra.coveredBy === entry.id) adjust(extra, 1);
    if (credit > CONTENT_CAPS.engineBase) throw new Error('Page calibration exceeds the engine baseline');
    if (page > 0) { input.page = page; input.engineBase = CONTENT_CAPS.engineBase - credit; }
    else { delete input.page; delete input.engineBase; }
  }
  /** `input` with every evictable claim's raw bytes taken out: a lower bound on what eviction could leave. */
  private withoutEvictable(input: ContentCostInput): ContentCostInput {
    const bound: ContentCostInput = { ...input };
    for (const category of CHARGED) {
      const bytes = this.evictableBytes[category];
      if (bytes !== 0) { const key = field[category]; bound[key] = (bound[key] ?? 0) - bytes; }
    }
    if (this.evictableBytes.page !== 0 || this.evictableCredit !== 0) {
      bound.page = (bound.page ?? 0) - this.evictableBytes.page; bound.engineBase = (bound.engineBase ?? CONTENT_CAPS.engineBase) + this.evictableCredit;
    }
    return bound;
  }
  private fits(extra: ResidencyClaim & { baseCredit: number }): boolean { return contentCost(this.input(extra)).playing <= this.playing; }
  /**
   * Prepare unneeded, unheld claims farthest-first until the prepared bytes make room; commit them all, or abort them all
   * and evict nothing. A failed commit retains its charge and aborts uncommitted preparations. Returns whether the claim now fits.
   */
  private evictFor(extra: ResidencyClaim & { baseCredit: number }): boolean {
    const prepared = this.prepareEviction(extra);
    if (prepared === null) return false;
    for (let index = 0; index < prepared.length; index++) {
      const current = prepared[index];
      if (current === undefined) throw new Error('Missing prepared eviction');
      try { current.eviction.commit(); }
      catch (error) { this.abortFrom(prepared, index, error); }
      this.drop(current.entry);
    }
    return this.fits(extra);
  }
  /** abort every eviction from `index` on, newest first, then rethrow the commit's error (with any abort failures) */
  private abortFrom(prepared: readonly { entry: Entry; eviction: ResidencyEviction }[], index: number, error: unknown): never {
    const errors = [error];
    for (const { eviction } of prepared.slice(index).reverse()) {
      try { eviction.abort(); } catch (failure) { errors.push(failure); }
    }
    if (errors.length > 1) throw new AggregateError(errors, 'Residency eviction failed', { cause: error });
    throw error;
  }
  /** the evictions that make room for `extra`, prepared farthest first; null (all aborted) when they cannot */
  private prepareEviction(extra: ResidencyClaim & { baseCredit: number }): { entry: Entry; eviction: ResidencyEviction }[] | null {
    const candidates = this.evictionCandidates();
    // When even evicting every eligible claim could not make room, nothing is prepared. (While a page sat over its target,
    // each further claim prepared and aborted every idle candidate: a neighbour's build registering its geometry held a
    // 600 ms frame on the phone at 4x.)
    if (contentCost(this.withoutEvictable(this.input(extra))).playing > this.playing) return null;
    const prepared: { entry: Entry; eviction: ResidencyEviction }[] = []; const omitted = new Set<string>(); let enough = false;
    let input = this.input(extra), revision = this.accountingRevision;
    for (const entry of candidates) {
      const eviction = entry.prepare?.() ?? null; if (eviction === null) continue;
      // A durability owner may release or resize a claim while preparing. Rebase only on an actual ledger change.
      if (revision !== this.accountingRevision) { input = this.input(extra, omitted); revision = this.accountingRevision; }
      prepared.push({ entry, eviction }); this.omit(input, entry, omitted, extra);
      if (contentCost(input).playing <= this.playing) { enough = true; break; }
    }
    if (!enough) { for (const { eviction } of prepared.reverse()) eviction.abort(); return null; }
    return prepared;
  }
  /** The evictable claims, farthest first (ids break ties): sorted once, then only the claims that left are dropped. */
  private evictionCandidates(): Entry[] {
    if (this.evictionOrder === null) { this.evictionOrder = [...this.evictable].sort((a, b) => b.distance - a.distance || a.id.localeCompare(b.id)); this.evictionStale = 0; }
    else if (this.evictionStale > 0) { this.evictionOrder = this.evictionOrder.filter(entry => this.evictable.has(entry)); this.evictionStale = 0; }
    return this.evictionOrder;
  }
  private drop(entry: Entry): void {
    if (this.entries_.get(entry.id) !== entry) return;
    this.track(entry, -1); this.entries_.delete(entry.id); this.orderedEntries = null; this.measured.delete(entry.id); this.refreshEviction(entry);
    const children = this.coverage.get(entry.id);
    if (children !== undefined) { this.adjustCoverage(children, 1); this.reshare(children); }
    // The table is already authoritative. Derive warning totals only when a resident report can consume them,
    // rather than re-walking every remaining cache allocation after each individual release.
    // Parent/page retirement can expose calibrated page coverage and must still validate that input immediately.
    if (this.memory.hasResidentWarnings || entry.category === 'sim' || entry.category === 'page') this.syncResidents();
  }
  private lease(entry: Entry): ResidencyLease {
    let released = false;
    const live = (): boolean => !released && this.entries_.get(entry.id) === entry;
    return Object.freeze({
      id: entry.id,
      shrink: (bytes: number): void => {
        if (!live()) return;
        if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > entry.bytes || entry.coveredBy !== undefined || this.coverage.has(entry.id) || entry.baseCredit !== 0)
          throw new RangeError('Invalid residency shrink');
        this.track(entry, -1); entry.bytes = bytes; this.track(entry, 1); this.refreshEviction(entry);
        if (this.memory.hasResidentWarnings) this.syncResidents();
      },
      update: (patch: { distance?: number; needed?: boolean; coveredBy?: string | null }): void => {
        if (!live()) return;
        if (patch.distance !== undefined) { if (!Number.isFinite(patch.distance) || patch.distance < 0) throw new RangeError('Invalid residency distance'); entry.distance = patch.distance; }
        if (patch.coveredBy !== undefined) {
          const covering = patch.coveredBy ?? undefined;
          this.validateCoverage(entry.id, entry.category, entry.bytes, covering);
          this.track(entry, -1); entry.coveredBy = covering; this.track(entry, 1);
        }
        if (patch.needed !== undefined) entry.needed = patch.needed;
        this.refreshEviction(entry);
      },
      hold: (): (() => void) => {
        if (!live()) return () => undefined;
        entry.holds++; this.refreshEviction(entry); let held = true;
        return () => { if (held) { held = false; entry.holds--; this.refreshEviction(entry); } };
      },
      evictWith: (prepare: () => ResidencyEviction | null): void => {
        if (!live() || this.evicting || entry.refs !== 1 || entry.prepare !== undefined) throw new Error('Eviction authority requires one live exclusive holder');
        entry.prepare = prepare; this.refreshEviction(entry);
      },
      release: (): void => {
        if (released) return; released = true;
        if (this.entries_.get(entry.id) !== entry) return;
        if (--entry.refs === 0) this.drop(entry);
      },
    });
  }
}
