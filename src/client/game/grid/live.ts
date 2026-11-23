import { finishSimSteps } from '@wildshard/engine/sim/snapshot';
import { prepareFrameMotors, type FrameMember } from '@wildshard/engine/physics/frame';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { TraversalReadiness, readinessModel, type ReadinessBundle, type ReadinessLink, type ReadinessTicket } from '@wildshard/engine/sim/readiness';
import type { ReadinessWalls } from '@wildshard/engine/physics/readinessWalls';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { GhostWorlds, type GhostRegion } from '../../../shared/game/grid/ghosts';
import { WORK_SLICE_MS, workSlice } from '@wildshard/engine/core/workSlice';
import type { DisposeStep } from '@wildshard/engine/app/scope';
import type { GridAssembly, GridCell, GridPoint } from '../../../shared/game/grid/assembly';
import type { ResidencyAllocator, ResidencyLease, ResidencyEviction } from '../../../shared/game/grid/allocator';
import type { PreparedGridCrossing } from '../../../shared/game/grid/crossing';
import type { HomeResidencyClaim } from './pageResidency';
import { ApproachInputsDeferredError } from './folderInputs';
import { PRODUCT_DEFERRED } from './folderLeases';
import { clientPreparationBatch } from '../shardfile/preparationTiming';
import type { RegionShell } from './regionShell';

/** A region on a page: the world its traveller's motor walks in. The server runs it and keeps its save. */
export interface LiveGridRegion { host: Pick<RegionShell, 'physics'>; dispose: () => void;
  /** M6 (G628): what should be collected once the region retires (its scope, its view root, its world); absent watches the
   *  region itself (`GhostWorlds`) */
  ghostRoots?: readonly object[];
  /** O20: the same disposal as steps (`Scope.disposeSteps`), so a retirement after a crossing spreads over frames */
  retire?: () => Generator<DisposeStep, void>;
  /** A runtime's own flush of what it holds; false keeps the traveller in the source frame. Nothing else here saves. */
  checkpoint?: () => boolean; walls?: ReadinessWalls }
/** Immutable content is admitted before its sim claim and world allocation; native runtime preparation imports only. */
export interface LiveGridAdmission {
  bytes: number;
  /** `signal` aborts a road-approach build when the traveller commits to a crossing into another cell: stop at the next safe
   * point and reject, disposing what was built (T7). */
  create: (claim: ResidencyLease, signal?: AbortSignal) => Promise<LiveGridRegion>;
  /** Release an unpublished product lease on refusal/cancellation. Idempotent after failed create or region disposal;
   *  successful publication transfers release to the returned region's dispose. */
  cancel?: () => void;
  prepareRuntime?: () => Promise<void>;
  /** Opaque foundations stay mutually exclusive unless their native factory explicitly promises isolated preparation. */
  exclusiveRuntime?: boolean;
  /** Host-owned bodyless declarative/client-plan construction owns its bindings and defers entered services.
   * Unknown/legacy factories never opt in merely because they accept an abort signal. */
  isolatedPreparation?: boolean;
  /** Declared render tiles can prepare a neighbour without constructing its region. */
  tilePreparation?: boolean;
}
/** G226: the initial home is an ordinary owned region; the neutral page constructs none of its opaque content. */
export interface LiveGridOwnedHome { mode: 'owned'; instance: string; bytes: number; residency: HomeResidencyClaim }
/** Neutral shell physics and its one traveller remain page-owned; disposal removes only platform installations. */
export interface LiveGridHighway { physics: Physics; dispose: () => void; walls?: ReadinessWalls; afterPlayerStep?: () => void }
/** An infallible prepared assignment rebinds the existing page world/player and the renderer's local origin. */
export interface LiveGridFrame { instance: string | null; physics: Physics; motor: FrameMember['motor']; origin: Readonly<{ x: number; z: number }> }
/** One live fixed-step owner supplies movement; region clocks/systems run only after that move. */
export interface LiveGridPorts {
  home: LiveGridOwnedHome; player: FrameMember; allocator: ResidencyAllocator;
  highway: { bytes: number; create: () => LiveGridHighway };
  /** Passive metadata may defer on headroom; required entry retains ordinary admission. */
  admit: (cell: GridCell, required?: boolean) => Promise<LiveGridAdmission>;
  /** Actual world construction or a verified render approach outranks product-only prefetch until its finite preparation drains. */
  prioritize?: (cell: GridCell) => () => void;
  /** Browser presentation boundary between admission batches; absent leaves the standalone Node scheduler unchanged. */
  pause?: () => Promise<void>;
  /** Metadata-only prefetch eligibility. Unsupported far proxies do not consume cold request slots; explicit transfers
   *  still run normal admission and readiness. Absent: every cell is a candidate, as in standalone Node drivers. */
  prefetchable?: (cell: GridCell) => boolean;
  /** Product-only prefetch waits while this is false (T10: the page's spawn settle); required entry never waits. Absent: always. */
  backgroundReady?: () => boolean;
  bindFrame: (frame: LiveGridFrame) => void;
  gameplayReady: (instance: string) => boolean;
  readiness: { link: ReadinessLink; bundle: (cell: GridCell) => ReadinessBundle };
  mount?: () => FrameMember | undefined;
  /** Keep only the last departed isolated world on the road. Its original
   * full claim stays unneeded/evictable; no new world may overlap it. */
  lastCell?: { readonly windowMs: number; readonly playingBytes: number;
    /** ZE3 / ZE21 (J352): the owned home, once departed onto the road, has no time expiry: it stays resident, and needed (never
     *  a pressure eviction), while the traveller is within this many metres of it (the page passes Infinity: the whole road),
     *  and is retired before any other cell's allocation. Absent: every cell expires. */
    readonly keepHome?: number;
    /** QA 11-23-b row 17 (J500, Jake 2026-11-23: re-entering Signal Dunes from the road swapped its far placeholder for the zone at the
     *  gate): any departed zone, home or not, stays resident and needed while the traveller is within this many metres of it (the
     *  page passes one road cell). Past it, it retires. Absent: only the home is kept. */
    readonly keepNear?: number;
    readonly schedule: (expire: () => void, delayMs: number) => () => void };
  /** J500 rule 2 (QA 11-23-b row 17, Jake 2026-11-23: a zone you approach is drawn at full detail before you reach its gate):
   *  on the road, the zone the traveller heads into starts its whole world build once its readiness estimate at the
   *  traveller's speed (at least `minSpeed`, the estimate times `margin`, plus `leadMetres`) covers the distance to its
   *  square. One zone at a time, beside the zone just left. Absent: a zone builds only at its gate (T7). */
  ahead?: { readonly minSpeed: number; readonly margin: number; readonly leadMetres: number };
  /** G580 T2: told once before a resident's retirement or unload disposes its world, so its compiled programs can be kept
   *  for the next world; never refuses a retirement. Absent keeps nothing. */
  keepPrograms?: (instance: string) => void;
}
/** Crossing telemetry is a production port: the harness verifies real fixed-boundary commits, never a page/debug probe. */
export interface LiveGridState {
  current: string | null; worldFeet: GridPoint; crossings: number;
  /** GC5: the world built ahead of the traveller (on the road or pre-warmed inside the source), and how many pre-warms began */
  ahead?: { readonly instance: string | null; readonly warms: number; readonly refused?: string | null; readonly deferred?: readonly string[]; readonly demanded?: string | null; readonly released?: number };
  /** Last complete world remains fully charged and pressure-evictable on the road. */
  retainedCell?: { readonly instance: string; readonly remainingMs: number; readonly playingBytes: number; readonly capBytes: number } | null;
  transitions: readonly { from: string | null; to: string | null }[];
  residents: readonly string[]; pending: readonly string[]; issues: Readonly<Record<string, string>>;
  /** Exact request ownership, without changing the legacy pending union. A cancelled
   * crossing may leave world construction running; settled alone cannot identify metadata. */
  pendingWork: readonly { readonly instance: string; readonly kind: 'world' | 'required-metadata' | 'optional-metadata';
    readonly trigger: 'entry' | 'explicit' | 'radial' | 'boulevard' }[];
  gameplayReady: boolean;
  /** O20: the latest region retirements, how long each one's checkpoint and disposal took (ms) */
  retirements?: readonly Retirement[];
  /** O20: regions still retiring in steps (out of `residents`, their claims still held) */
  retiring?: readonly string[];
  /** M6 (G628): ghost worlds (retired regions still alive 30 s on) and every retired region not yet collected */
  ghosts?: { readonly count: number; readonly regions: readonly GhostRegion[] };
}
/** O20: one region retirement: its checkpoint, its disposal's whole span, and for a sliced one its steps and slowest step */
export interface Retirement { instance: string; checkpointMs: number; disposeMs: number; steps?: number; workMs?: number; slowestStepMs?: number; slowestStep?: string; failed?: boolean }
interface RetiringRegion { readonly instance: string; readonly resident: Resident; readonly steps: Generator<DisposeStep, void>;
  readonly checkpointMs: number; readonly start: number; count: number; workMs: number; slowestMs: number; slowest: string; done: boolean;
  /** settles when `finishRetirement` ran (its claim released, or kept on failure) */
  readonly finished: Promise<void>; readonly settle: () => void }
interface Resident { region: LiveGridRegion; lease: ResidencyLease; reservations: number; evicting: boolean; retainable: boolean; evictionBound?: boolean; disposalFailed?: boolean }

/** One page traveller with frozen owned regions. Borrowed homes keep the existing standalone composition;
 * owned homes begin on neutral page physics and transfer the sole preallocation claim to their first runtime. */
export class LiveGridHost {
  readonly readiness: TraversalReadiness = new TraversalReadiness();
  private readonly residents = new Map<string, Resident>();
  private readonly requests = new Map<string, Promise<void>>();
  /** Admitted constructors own the product they consumed; queued requests may still prefetch theirs. */
  private readonly constructing = new Set<string>();
  private readonly retirements: Retirement[] = [];
  private readonly ghosts = new GhostWorlds();
  private readonly retiring = new Map<string, RetiringRegion>();
  private readonly products = new Map<string, LiveGridAdmission>();
  /** Verified render capability only; runtime import completion still gates products/readiness. */
  private readonly tileMetadata = new Set<string>();
  private readonly folderRequests = new Map<string, { work: Promise<LiveGridAdmission>; required: boolean;
    trigger: 'entry' | 'explicit' | 'radial' | 'boulevard' }>();
  private readonly deferredFolders = new Map<string, number>();
  /** GC6: a demand read (the neighbour ahead) the budget refused, by allocator revision: kept apart from the radial reads'
   *  deferrals, since a radial read deferred for want of headroom must not stop the demand read that may make room */
  private readonly deferredDemand = new Map<string, number>();
  private readonly issues = new Map<string, string>();
  private readonly refusals = new Map<string, unknown>();
  /** One failed cold unload per excursion; quota failures retain their full claim until retry or re-approach. */
  private readonly coldUnloadRefused = new Set<string>();
  private readonly frames = new Set<() => void>();
  private frameGeneration = 0;
  private readonly transitions: { from: string | null; to: string | null }[] = [];
  private crossings = 0;
  /** GC6: the neighbour whose product is read as demand (the nearest edge's, or the heading's) and not yet admitted: radial
   *  reads of other cells wait while it is missing, so they don't take back the headroom its read needs. */
  private demanded: string | null = null;
  private initialHomePending: boolean;
  private readonly highwayLease: ResidencyLease;
  private readonly highway: LiveGridHighway;
  private sequence: Promise<void> = Promise.resolve();
  private active: string | null;
  /** `pinned`: the owned home kept on the road (ZE21): needed while kept, so allocator pressure (a neighbour's tiles or
   *  products) is refused rather than evicting it. */
  private lastCell: { readonly instance: string; readonly until: number; readonly pinned: boolean; cancel: () => void } | null = null;
  private disposed = false;
  /** Each checkpoint of an instance takes a generation; a staged one still waiting is superseded by any later one. */
  private highwayDisposed = false;
  readonly assembly: GridAssembly;
  private readonly ports: LiveGridPorts;

  constructor(assembly: GridAssembly, ports: LiveGridPorts) {
    this.assembly = assembly; this.ports = ports;
    if (ports.lastCell !== undefined && (!Number.isFinite(ports.lastCell.windowMs) || ports.lastCell.windowMs <= 0 || ports.lastCell.windowMs > 60_000
      || !Number.isSafeInteger(ports.lastCell.playingBytes) || ports.lastCell.playingBytes <= 0)) throw new RangeError('Invalid last-cell retention policy');
    this.active = null; this.initialHomePending = true;
    this.validateHomeClaim(ports.home.residency);
    this.highwayLease = this.claim('platform.highway', ports.highway.bytes, true);
    try { this.highway = ports.highway.create(); try {
        if (this.highway.physics.world.getCollider(ports.player.motor.collider.handle) !== ports.player.motor.collider) throw new Error('Neutral highway must contain the existing page traveller');
      } catch (error) { this.highway.dispose(); throw error; } }
    catch (error) { this.highwayLease.release(); throw error; }
  }
  private validateHomeClaim(claim: HomeResidencyClaim): void {
    const home = this.ports.home;
    if (claim.instance !== home.instance || claim.bytes !== home.bytes || claim.allocator !== this.ports.allocator) throw new Error('Live home residency differs from its admitted page claim');
  }
  private claim(instance: string, bytes: number, needed: boolean): ResidencyLease {
    const lease = this.ports.allocator.reserve({ id: `sim:${instance}`, category: 'sim', owner: instance, bytes, distance: 0, needed });
    if (lease === null) throw new Error('Live sim admission deferred by the shared budget');
    return lease;
  }
  /** Null identifies the permanent highway/strip world. */
  private followingServer = false;
  current(): string | null { return this.active; }
  private origin(instance: string | null): { x: number; z: number } { return instance === null ? { x: 0, z: 0 } : this.assembly.cell(instance).origin; }
  private region(instance: string | null): LiveGridRegion | undefined { return instance === null ? undefined : this.residents.get(instance)?.region; }
  private physics(instance: string | null): Physics {
    if (instance === null) return this.highway.physics;
    const region = this.region(instance); if (region === undefined) throw new Error('Live grid region is not admitted'); return region.host.physics;
  }
  /** Render/global coordinates are derived, never written into an authored regional host. */
  worldFeet(): GridPoint { const p = this.ports.player.position, origin = this.origin(this.active); return { x: p.x + origin.x, y: p.y, z: p.z + origin.z }; }
  /** Gate selects only the home and road. Worker retains the parked 6 m enter / 10 m leave selection. */
  target(feet: Readonly<GridPoint>): string | null {
    if (![feet.x, feet.y, feet.z].every(Number.isFinite)) throw new RangeError('Invalid live grid feet');
    const distance = (cell: GridCell): number => Math.max(Math.abs(feet.x - cell.origin.x), Math.abs(feet.z - cell.origin.z)) - CHUNK_HALF;
    if (this.active !== null && distance(this.assembly.cell(this.active)) <= 10) return this.active;
    const home = this.assembly.cell(this.ports.home.instance);
    return distance(home) <= 6 ? home.instance : null;
  }
  /** Admission includes colliders, initialized sim and parsed runtime module; entered hooks are a separate gameplay fence. */
  ready(instance: string | null): boolean {
    if (this.disposed) return false;
    if (instance === null) return true;
    const resident = this.residents.get(instance);
    return resident !== undefined && !resident.evicting && !resident.disposalFailed && this.readiness.isReady(instance);
  }
  /** Submit whole-shard requests in stable order. Failed attempts remain closed until an explicit retry. */
  prefetch(instances: readonly string[], trigger: 'explicit' | 'radial' | 'boulevard' = 'explicit'): Promise<void> { return Promise.all([...new Set(instances)].sort().map((id) => this.residents.has(id) || (!this.disposed && this.constructing.has(id)) || this.deferredFolders.get(id) === this.ports.allocator.revision ? Promise.resolve() : this.prefetchFolder(id, false, trigger))).then(() => undefined); }
  private async requireFolder(instance: string, pending: Promise<LiveGridAdmission>, trigger: 'entry' | 'explicit' | 'radial' | 'boulevard' = 'entry', speculative = false): Promise<LiveGridAdmission> {
    try { return await pending; }
    catch (error) {
      // the optional read's budget deferral says nothing of a required one: read it again as required
      if (!(error instanceof ApproachInputsDeferredError) && !(error instanceof Error && error.message.includes(PRODUCT_DEFERRED))) throw error;
      return this.prefetchFolder(instance, true, trigger, speculative);
    }
  }
  /** `speculative`: a demand read nobody waits on yet (GC5's near neighbour and pre-warm). Its budget refusal is deferred
   *  until the budget changes, as a radial read's is, not a failed cell that closes the radial read, the pre-warm and the road. */
  private prefetchFolder(instance: string, required = false, trigger: 'entry' | 'explicit' | 'radial' | 'boulevard' = 'entry', speculative = false): Promise<LiveGridAdmission> {
    this.assertAlive(); const cell = this.assembly.cell(instance);
    const product = this.products.get(instance); if (product !== undefined) return Promise.resolve(product);
    const pending = this.folderRequests.get(instance);
    if (pending !== undefined) return !required || pending.required ? pending.work : this.requireFolder(instance, pending.work, trigger, speculative);
    const issue = this.issues.get(instance); if (issue !== undefined) return Promise.reject(new Error(issue));
    const timing = clientPreparationBatch(cell.slug, `grid.product:${instance}`, ['admission', 'runtime']);
    const request = (async (): Promise<LiveGridAdmission> => {
      let admission: LiveGridAdmission | undefined;
      try {
        await Promise.resolve(); this.assertAlive();
        const admitted = timing === undefined ? await this.ports.admit(cell, required) : await timing.run('admission', () => this.ports.admit(cell, required));
        admission = admitted; this.assertAlive();
        if (admission.tilePreparation === true) this.tileMetadata.add(instance);
        const bundle = this.ports.readiness.bundle(cell);
        if ((bundle.runtimePageWireBytes > 0 || admission.exclusiveRuntime === true) && admission.prepareRuntime === undefined) throw new Error('Runtime admission is missing');
        await (timing === undefined ? admission.prepareRuntime?.() : timing.run('runtime', async () => { await admitted.prepareRuntime?.(); }));
        this.assertAlive();
        this.deferredFolders.delete(instance); this.deferredDemand.delete(instance); this.products.set(instance, admission); return admission;
      } catch (error) {
        this.tileMetadata.delete(instance);
        const refused = error instanceof ApproachInputsDeferredError || (error instanceof Error && error.message.includes(PRODUCT_DEFERRED));
        // GC6 (QA 11-14 row 6): inside Driftwood the page held 3 to 5 neighbours' radial products (1199 of 1200 MB), pinned
        // while held, so Nalati's demand read was refused the whole approach and its world was built only on the road. A
        // refused demand read lets the speculative products of other cells go, farthest first, and is read again.
        if (required && speculative && refused) { if (this.releaseSpeculative(instance) > 0) this.deferredDemand.delete(instance); else { this.deferredDemand.set(instance, this.ports.allocator.revision); if (this.demanded === instance) this.demanded = null; } }
        else if (!required && refused) this.deferredFolders.set(instance, this.ports.allocator.revision);
        else { this.issues.set(instance, error instanceof Error ? error.message : String(error)); this.refusals.set(instance, error); }
        try { admission?.cancel?.(); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Live product admission and cancellation failed', { cause: cleanup }); }
        throw error;
      } finally { this.folderRequests.delete(instance); timing?.finish(); }
    })();
    this.folderRequests.set(instance, { work: request, required, trigger }); return request;
  }
  /** GC6: let every admitted product nobody builds, enters or reads ahead go except `kept`'s, farthest first (each releases
   *  its claim, so the allocator's revision moves and a deferred demand read is tried again). Returns how many went. */
  private releaseSpeculative(kept: string): number {
    const feet = this.worldFeet(), keep = (id: string): boolean => id === kept || id === this.active || id === this.ahead
      || this.constructing.has(id) || this.requests.has(id) || this.residents.has(id)
      || id === this.transportApproach?.instance;
    const idle = [...this.products.keys()].filter(id => !keep(id))
      .sort((a, b) => this.distance(this.assembly.cell(b), feet) - this.distance(this.assembly.cell(a), feet));
    for (const id of idle) {
      const admission = this.products.get(id); this.products.delete(id); this.tileMetadata.delete(id);
      try { admission?.cancel?.(); } catch (error) { console.warn(`[grid] ${id}: releasing a speculative product`, error); }
    }
    this.released += idle.length;
    return idle.length;
  }
  /** GC6: how many speculative products a demand read let go (`releaseSpeculative`), for the tour */
  private released = 0;
  /** GC5 / GC36: the cell whose world the road is building or built ahead of its line (`buildAhead`), kept until the
   *  traveller enters a cell or heads into another's mouth. */
  private ahead: string | null = null;
  /** J500 rule 2: the feet at the last fixed step (the heading and speed), and how many builds ahead began */
  private aheadFeet: GridPoint | null = null;
  private aheadBuilds = 0;
  private transportApproach: { instance: string; controller: AbortController; work: Promise<void> } | null = null;
  private retiredTransport: Promise<void> = Promise.resolve();
  private stopApproachTransport(): void {
    const previous = this.transportApproach; if (previous === null) return;
    this.transportApproach = null; previous.controller.abort();
    this.retiredTransport = this.settle(previous.work);
  }
  private ensure(instance: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Live grid is disposed'));
    const cell = this.assembly.cell(instance);
    if (this.transportApproach?.instance !== instance) this.stopApproachTransport();
    if (this.residents.has(instance)) return Promise.resolve();
    const pending = this.requests.get(instance); if (pending !== undefined) return pending;
    const issue = this.issues.get(instance); if (issue !== undefined) return Promise.reject(new Error(issue));
    const bundle = this.ports.readiness.bundle(cell), estimate = readinessModel(bundle, this.ports.readiness.link);
    const ticket = this.readiness.request(instance, 0, estimate, bundle.runtimePageWireBytes > 0);
    if (ticket === null) return Promise.reject(new Error('Stale live grid readiness request'));
    const transport = this.transportApproach, releasePriority = this.ports.prioritize?.(cell);
    const request = this.admitRegion(cell, bundle, ticket, this.sequence).finally(() => {
      if (transport !== null && this.transportApproach === transport) this.stopApproachTransport();
      releasePriority?.();
    });
    this.requests.set(instance, request); this.sequence = this.settle(request); return request;
  }
  private assertAlive(): void { if (this.disposed) throw new Error('Live grid is disposed'); }
  private async settle(request: Promise<void>): Promise<void> { try { await request; } catch { /* The requesting owner receives the admission error. */ } }
  private async admitRegion(cell: GridCell, bundle: ReadinessBundle, ticket: ReadinessTicket, previous: Promise<void>): Promise<void> {
    const instance = cell.instance, timing = clientPreparationBatch(cell.slug, `grid.prepare:${cell.instance}`, ['queue', 'metadata', 'create']);
    let admission: LiveGridAdmission | undefined;
    try {
      await (timing === undefined ? previous : timing.run('queue', () => previous));
      await this.retiredTransport;
      this.assertAlive();
      const admitted = timing === undefined ? await this.prefetchFolder(instance, true) : await timing.run('metadata', () => this.prefetchFolder(instance, true));
      admission = admitted;
      this.assertAlive();
      // its previous world may still be retiring (`retire`): its claim, under the same id, is released only at its last step,
      // so this admission's claim waits for it
      for (let retiring = this.retiring.get(instance); retiring !== undefined; retiring = this.retiring.get(instance)) { await retiring.finished; this.assertAlive(); }
      // A failed disposal stays fully charged and blocks construction even if the pair's budget would fit.
      if ([...this.residents.values()].some((row) => row.disposalFailed === true)) throw new Error('Exclusive runtime awaits successful disposal');
      this.products.delete(instance);
      this.constructing.add(instance);
      let lease: ResidencyLease;
      if (instance === this.ports.home.instance && this.initialHomePending) {
        // Runtime admission has checked the same measured source and manifest. Transfer only that exact whole cost;
        // until then the boot owner retains its sole reference and can abort without any regional world existing.
        lease = this.ports.home.residency.handoff(admitted.bytes); this.initialHomePending = false;
      } else {
        if (this.initialHomePending) {
          // Road recovery may enter another opaque runtime first. No home content has been allocated, so retire its
          // unused boot reservation before requesting the destination budget; a future home visit is ordinary admission.
          this.ports.home.residency.releasePending(); this.initialHomePending = false;
        }
        lease = this.claim(instance, admitted.bytes, true);
      }
      let region: LiveGridRegion | undefined;
      try {
        if (bundle.runtimePageWireBytes > 0 && admitted.prepareRuntime === undefined) throw new Error('Runtime admission is missing');
        this.assertAlive(); this.readiness.complete(ticket, 'runtime');
        if (this.ports.pause !== undefined) await this.ports.pause();
        this.assertAlive();
        region = timing === undefined ? await admitted.create(lease) : await timing.run('create', () => admitted.create(lease));
        if (this.ports.pause !== undefined) await this.ports.pause();
        this.assertAlive();
        this.residents.set(instance, { region, lease, reservations: 0, evicting: false, retainable: admitted.isolatedPreparation === true });
        this.readiness.complete(ticket, 'colliders'); this.readiness.complete(ticket, 'sim');
        lease.update({ needed: false, distance: this.distance(cell) });
      } catch (error) {
        try { region?.dispose(); }
        catch (cleanup) {
          if (region !== undefined) this.residents.set(instance, { region, lease,
            reservations: 0, evicting: false, retainable: false, disposalFailed: true });
          admission = undefined; // The retained world still owns its product and its full claim.
          throw new AggregateError([error, cleanup], 'Live region creation and disposal failed', { cause: cleanup });
        }
        lease.release(); throw error;
      }
    } catch (error) {
      this.readiness.invalidate(instance);
      this.issues.set(instance, error instanceof Error ? error.message : String(error)); this.refusals.set(instance, error);
      this.products.delete(instance);
      try { admission?.cancel?.(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Live admission and product cancellation failed', { cause: cleanup }); }
      throw error;
    } finally { this.constructing.delete(instance); this.requests.delete(instance); timing?.finish(); }
  }
  private forgetLastCell(instance?: string): void {
    const last = this.lastCell;
    if (last === null || instance !== undefined && last.instance !== instance) return;
    this.lastCell = null; last.cancel();
  }
  private retainedFits(instance: string): boolean {
    const policy = this.ports.lastCell;
    // J500 rule 1: a world just played is kept up to the policy's own line, not the envelope: the traveller already played it
    // there (Driftwood plays 1.18 GB against the 1.0 GB envelope on a phone), and its bound eviction still yields it to an entry
    return policy !== undefined && this.ports.allocator.ownerCost(instance).playing <= policy.playingBytes;
  }
  /** Call only after entered leave hooks finish. Keep the same ready world,
   * without a second claim, snapshot, physics host or shader preparation. */
  retainDeparted(instance: string): boolean {
    const policy = this.ports.lastCell, resident = this.residents.get(instance);
    if (this.disposed || this.active !== null || policy === undefined || resident?.retainable !== true
      || resident.evicting || resident.disposalFailed === true || !this.retainedFits(instance)) return false;
    if (this.lastCell?.instance === instance) return true;
    // Install the existing program keeper before this world can be an allocator
    // eviction candidate: eviction callbacks may not reserve their own claims.
    this.ports.keepPrograms?.(instance);
    if (!this.retainedFits(instance)) return false;
    if (resident.evictionBound !== true) {
      const bind = resident.lease.evictWith;
      if (bind === undefined) return false;
      try {
        bind(() => {
          if (this.residents.get(instance) !== resident) return null;
          const prepared = this.prepareUnload(instance);
          return prepared === null ? null : { abort: prepared.abort, commit: () => {
            prepared.commit();
            // A failed disposer keeps its full claim; never let allocator
            // eviction remove it merely because the callback returned.
            if (this.residents.get(instance) === resident) throw new Error('Retained world disposal failed');
          } };
        });
        resident.evictionBound = true;
      } catch { return false; }
    }
    this.forgetLastCell();
    const kept = this.keptNear(instance, policy);
    const last = { instance, until: kept ? Number.POSITIVE_INFINITY : diagnosticNow() + policy.windowMs, pinned: kept, cancel: (): void => undefined };
    this.lastCell = last;
    if (kept) {
      resident.lease.update({ needed: true, distance: this.distance(this.assembly.cell(instance)) });
      return true;
    }
    try {
      last.cancel = policy.schedule(() => {
        if (this.lastCell !== last) return;
        this.forgetLastCell();
        this.retire(instance);
      }, policy.windowMs);
    } catch { this.forgetLastCell(); return false; }
    if (this.lastCell !== last) last.cancel();
    resident.lease.update({ needed: false, distance: this.distance(this.assembly.cell(instance)) });
    return this.lastCell === last;
  }
  /** ZE21 and J500: whether a departed zone is kept (needed, no expiry) where the traveller stands now. */
  private keptNear(instance: string, policy: NonNullable<LiveGridPorts['lastCell']>): boolean {
    const away = this.distance(this.assembly.cell(instance));
    return policy.keepHome !== undefined && instance === this.ports.home.instance && away <= policy.keepHome
      || policy.keepNear !== undefined && away <= policy.keepNear;
  }
  private distance(cell: GridCell, p = this.worldFeet()): number { return Math.hypot(Math.max(0, Math.abs(p.x - cell.origin.x) - CHUNK_HALF), Math.max(0, Math.abs(p.z - cell.origin.z) - CHUNK_HALF)); }
  /** Only the active/reserved world and one bounded departed world can remain.
   * A different actual entry retires the departure before any new allocation. */
  private retireInactiveRegions(destination?: string): boolean {
    const last = this.lastCell;
    const policy = this.ports.lastCell;
    if (last !== null && (diagnosticNow() >= last.until || !this.retainedFits(last.instance)
      || last.pinned && policy !== undefined && !this.keptNear(last.instance, policy)
      || this.active !== null || destination !== undefined && destination !== last.instance)) this.forgetLastCell();
    let released = true;
    for (const [instance, resident] of this.residents) {
      const needed = instance === this.active || instance === destination || instance === this.ahead || this.requests.has(instance) || resident.reservations > 0
        || this.lastCell?.instance === instance && this.lastCell.pinned;
      resident.lease.update({ distance: this.distance(this.assembly.cell(instance)), needed: needed || resident.disposalFailed === true });
      if (needed || this.lastCell?.instance === instance) continue;
      if (resident.disposalFailed === true || resident.evicting || this.coldUnloadRefused.has(instance)) { released = false; continue; }
      if (!this.retire(instance)) { this.coldUnloadRefused.add(instance); released = false; }
    }
    return released;
  }
  /** GC6: whether a world is being built (pre-warmed inside the source, built ahead on the road, or entered): every world build
   *  is for a cell the traveller heads into, so its slices are urgent (`setBuildUrgent`). */
  building(): boolean { return this.requests.size > 0; }
  /** Retry after a durability/budget change, instead of fetching the same failed request every tick. */
  retry(instance: string): void {
    if (this.requests.has(instance) || this.folderRequests.has(instance)) throw new Error('Live admission is still pending');
    this.coldUnloadRefused.delete(instance); this.deferredFolders.delete(instance); this.deferredDemand.delete(instance);
    // A quota-refused unload kept a complete native region: retry must not invalidate its valid readiness ticket.
    if (this.residents.has(instance)) return;
    this.issues.delete(instance); this.refusals.delete(instance); this.readiness.invalidate(instance);
  }
  /** Preserve the original error identity for classified UI, instead of inferring failure type from a message. */
  refusal(instance: string): unknown { return this.refusals.get(instance); }
  /** Before the existing page physics/player step: radial requests are U-turn safe, and current-world walls synchronize first. */
  beforeFixed(): void {
    if (this.disposed) return;
    this.beforeFixedWithWork();
  }
  private beforeFixedWithWork():void{
    // J353: one crossing implementation. J500 rule 2: on the road, the zone ahead builds before its gate (`buildAhead`).
    this.retireInactiveRegions();
    this.buildAhead();
    const walls = this.active === null ? this.highway.walls : this.region(this.active)?.walls;
    walls?.sync(this.readiness);
  }
  /** J500 rule 2: the speed-led lead (m) at which `instance`'s whole world starts building from the road. */
  private aheadLead(instance: string, speed: number): number {
    const policy = this.ports.ahead; if (policy === undefined) return -1;
    const estimate = readinessModel(this.ports.readiness.bundle(this.assembly.cell(instance)), this.ports.readiness.link);
    return policy.leadMetres + Math.max(speed, policy.minSpeed) * estimate.seconds * policy.margin;
  }
  /**
   * J500 rule 2 (QA 11-23-b row 17): on the road, the nearest zone whose square the feet close on, within its speed-led
   * lead, builds its whole world now through the ordinary entry path (`ensure`), so the crossing finds it resident and the
   * road draws it (`drawnFromRoad`). The zone just left stays as rule 1 keeps it. A zone being built ahead stays the one
   * ahead while the feet stay within its lead (a stop or a jump keeps it); past it the next one may take its place, and
   * the old one retires as any unneeded world does. A refused build (the shared budget) waits for the gate, as before.
   */
  private buildAhead(): void {
    if (this.ports.ahead === undefined) return;
    const feet = this.worldFeet(), previous = this.aheadFeet; this.aheadFeet = feet;
    if (this.active !== null) { this.ahead = null; return; }
    const speed = previous === null ? 0 : Math.hypot(feet.x - previous.x, feet.z - previous.z) * 60;
    const held = this.ahead;
    if (held !== null && (this.issues.has(held) || this.distance(this.assembly.cell(held), feet) > this.aheadLead(held, speed))) this.ahead = null;
    if (this.ahead !== null || previous === null || this.requests.size > 0) return;
    let best: GridCell | undefined, bestDistance = Infinity;
    for (const cell of this.assembly.cells) {
      const id = cell.instance;
      if (this.residents.has(id) || this.issues.has(id) || this.constructing.has(id) || this.retiring.has(id)) continue;
      // heading in: closing on its centre (along the road, the middle of its edge, where its gate stands), within a pitch
      const distance = this.distance(cell, feet), centre = (p: GridPoint): number => Math.hypot(p.x - cell.origin.x, p.z - cell.origin.z);
      if (distance >= bestDistance || distance >= this.assembly.pitch || centre(feet) >= centre(previous) - 0.000001) continue;
      if (distance > this.aheadLead(id, speed)) continue;
      best = cell; bestDistance = distance;
    }
    if (best === undefined) return;
    const id = best.instance;
    this.ahead = id; this.aheadBuilds++;
    void this.ensure(id).catch(() => { if (this.ahead === id) this.ahead = null; });
  }
  /** J500 rules 1 and 2: on the road, the ready resident worlds the page draws from outside their cells (the zone just left,
   *  the zone built ahead); none inside a cell. */
  drawnFromRoad(): string[] {
    if (this.disposed || this.active !== null) return [];
    return [...this.residents.keys()].filter(id => this.ready(id)).sort();
  }
  /** The server runs these worlds now (J130): a region's own law stands still, and its views draw what the wire says. */
  followServer(): void { this.followingServer = true; }
  /** Once after the existing player move; paused hook installation does not advance the region's simulation. */
  afterPlayerStep(): void {
    if (this.followingServer) return;
    if (this.disposed || (this.active !== null && !this.ports.gameplayReady(this.active))) return;
    if (this.active === null) this.highway.afterPlayerStep?.();
  }
  /** Owned regions capture the current traveller without acquiring its motor. */
  checkpoint(instance: string): boolean { return finishSimSteps(this.checkpointSteps(instance)); }
  /** The same checkpoint in stages, for a periodic autosave spread over frames (rt3-freeze): the first `next()` captures
   *  at the caller's fixed-step boundary; later stages encode and write. A later checkpoint, a crossing or an unload
   *  supersedes it: it then returns false without writing, so an older capture never replaces a newer save. */
  // oxlint-disable-next-line require-yield -- liveSession's autosave delegates here with yield*; a page region saves in one stage.
  *checkpointSteps(instance: string): Generator<undefined, boolean> {
    if (this.disposed) return false;
    const resident = this.residents.get(instance); if (resident === undefined) return false;
    return resident.region.checkpoint?.() ?? true;
  }
  /** Prepare durability before allocator eviction; commit only disposes an already-frozen world. */
  prepareUnload(instance: string): ResidencyEviction | null {
    const resident = this.residents.get(instance);
    if (resident === undefined || this.disposed || instance === this.active || resident.reservations > 0 || resident.evicting) return null;
    const checkpointStart = diagnosticNow();
    try { if (!resident.disposalFailed && !this.checkpoint(instance)) return null; } catch { return null; }
    const checkpointMs = diagnosticNow() - checkpointStart;
    resident.evicting = true; let closed = false;
    return { abort: () => { if (closed) return; closed = true; resident.evicting = false; }, commit: () => {
      if (closed) return; closed = true;
      this.ports.keepPrograms?.(instance);
      const disposeStart = diagnosticNow();
      try { resident.region.dispose(); this.noteRetirement({ instance, checkpointMs, disposeMs: diagnosticNow() - disposeStart }); this.ghosts.retired(instance, resident.region.ghostRoots ?? [resident.region]); }
      catch (error) {
        resident.evicting = false; resident.disposalFailed = true; resident.lease.update({ needed: true });
        this.readiness.invalidate(instance); this.issues.set(`cleanup:${instance}`, error instanceof Error ? error.message : String(error)); return;
      }
      this.residents.delete(instance); this.readiness.invalidate(instance);
      this.forgetLastCell(instance);
      resident.lease.release();
    } };
  }
  /** Leave active/home/highway worlds intact; unload only a durably checkpointed frozen region. */
  /**
   * O20: retire a frozen region after its crossing without a long frame: checkpoint it now, take it out of the residents
   * (its readiness closes), then run its disposal in steps under the loading slice budget. Its claim stays held until the
   * last step, and every later admission waits for it (`sequence`), so its memory is released before anything replaces
   * it. A region with no stepped disposal, or one that cannot retire now, takes `unload`.
   */
  retire(instance: string): boolean {
    const resident = this.residents.get(instance), retire = resident?.region.retire;
    if (resident === undefined || retire === undefined || this.disposed || instance === this.active || resident.reservations > 0
      || resident.evicting || resident.disposalFailed === true) return this.unload(instance);
    const checkpointStart = diagnosticNow();
    try { if (!this.checkpoint(instance)) return false; } catch { return false; }
    const checkpointMs = diagnosticNow() - checkpointStart;
    resident.evicting = true;
    const record = this.startRetirement(instance, resident, retire, checkpointMs);
    this.sequence = this.settle(Promise.all([this.sequence, this.drainRetirement(record)]).then(() => undefined));
    return true;
  }
  /** a frozen, checkpointed world leaves the residents (its readiness closes) and starts its stepped disposal; its claim
   *  stays held until `finishRetirement` */
  private startRetirement(instance: string, resident: Resident, retire: () => Generator<DisposeStep, void>, checkpointMs: number): RetiringRegion {
    this.ports.keepPrograms?.(instance);
    this.forgetLastCell(instance);
    this.residents.delete(instance); this.readiness.invalidate(instance);
    this.ghosts.retired(instance, resident.region.ghostRoots ?? [resident.region]);
    let settle = (): void => undefined;
    const finished = new Promise<void>(resolve => { settle = resolve; });
    const record: RetiringRegion = { instance, resident, steps: retire(), checkpointMs, start: diagnosticNow(), count: 0, workMs: 0, slowestMs: 0, slowest: '', done: false, finished, settle };
    this.retiring.set(instance, record);
    return record;
  }
  /** one disposal step of a retiring world; true once its last step ran */
  private advance(record: RetiringRegion): boolean {
    const at = diagnosticNow(), step = record.steps.next(), ms = diagnosticNow() - at;
    record.count++; record.workMs += ms;
    if (ms > record.slowestMs) { record.slowestMs = ms; record.slowest = step.done === true ? 'final' : `${step.value.scope}:${step.value.kind}`; }
    return step.done === true;
  }
  private async drainRetirement(record: RetiringRegion): Promise<void> {
    // Its own stretch per frame, not the builds' shared one: starved by tile and prefetch work it took 31-35 s on the
    // Simulator, holding the left region's memory and the next admission (which waits on `sequence`) that long
    const slice = workSlice();
    let stretch = diagnosticNow();
    try {
      for (;;) {
        if (record.done) return;
        if (this.advance(record)) break;
        if (diagnosticNow() - stretch >= WORK_SLICE_MS) { await slice.yield(); stretch = diagnosticNow(); }
      }
      this.finishRetirement(record, undefined);
    } catch (error) { this.finishRetirement(record, { error }); }
  }
  private finishRetirement(record: RetiringRegion, failure: { readonly error: unknown } | undefined): void {
    if (record.done) return;
    record.done = true; this.retiring.delete(record.instance); record.settle();
    const { instance, resident } = record, row = { instance, checkpointMs: record.checkpointMs, disposeMs: diagnosticNow() - record.start,
      steps: record.count, workMs: Math.round(record.workMs), slowestStepMs: Math.round(record.slowestMs), slowestStep: record.slowest };
    if (failure !== undefined) {
      const { error } = failure;
      // A partly freed world keeps its full claim and blocks exclusive admissions, as a failed `unload` does.
      resident.evicting = false; resident.disposalFailed = true; resident.lease.update({ needed: true }); this.residents.set(instance, resident);
      this.issues.set(`cleanup:${instance}`, error instanceof Error ? error.message : String(error)); this.noteRetirement({ ...row, failed: true }); return;
    }
    resident.lease.release(); this.noteRetirement(row);
  }
  private noteRetirement(row: Retirement): void { this.retirements.push(row); if (this.retirements.length > 16) this.retirements.shift(); }
  unload(instance: string): boolean { if (!this.residents.has(instance)) return true; const prepared = this.prepareUnload(instance); if (prepared === null) return false; prepared.commit(); return !this.residents.has(instance); }
  /** Prepare disabled replacement controllers while the existing page stays authoritative; no entered runtime hooks run here. */
  async prepare(from: string | null, to: string | null): Promise<PreparedGridCrossing> {
    if (this.disposed || this.active !== from || from === to) throw new Error('Stale live frame preparation');
    // An entry anywhere but the world built ahead lets that world go, so it retires before this one allocates. Stepping out
    // onto the road keeps one pre-warmed from inside the source (GC5).
    if (to !== null && this.ahead !== to) this.ahead = null;
    if (from !== null && to !== null) throw new Error('Owned runtime crossing must commit onto the neutral road first');
    // Protect a ready return before yielding: expiry/pressure cannot free it
    // between its selection and the final prepared-frame reservation.
    const returning = to === null ? undefined : this.residents.get(to), releaseReturn = returning?.lease.hold();
    if (returning !== undefined) returning.reservations++;
    try {
    const generation = ++this.frameGeneration;
    for (const cancelPrevious of this.frames) cancelPrevious();
    const current = (): void => {
      this.assertAlive();
      if (generation !== this.frameGeneration || this.active !== from) throw new Error('Stale live frame preparation');
    };
    if (from === null && to !== null) {
      // Drain any superseded requested entry, then release every unentered world
      // before the requested destination allocates. Refused disposal stays charged.
      // J500: a ready destination (the zone just left, or the one built ahead) allocates nothing, so it waits on no other
      // world's build (a zone built ahead that the traveller turned away from retires once it is done).
      const resident = this.ready(to);
      if (!resident) await this.sequence;
      current();
      if (!this.retireInactiveRegions(to)) throw new Error('Exclusive runtime awaits successful disposal');
      if (!resident) await this.sequence;
      current();
      if (this.current() !== from) throw new Error('Stale live frame preparation');
    }
    if (to !== null) await this.ensure(to);
    current();
    if (this.active !== from || !this.ready(to)) throw new Error('Unready live frame preparation');
    const resident = to === null ? undefined : this.residents.get(to), releaseHold = resident?.lease.hold();
    if (resident !== undefined) resident.reservations++;
    const source = this.origin(from), origin = this.origin(to), rider = { position: this.ports.player.position, motor: this.ports.player.motor }, mount = this.ports.mount?.();
    let motors: ReturnType<typeof prepareFrameMotors>;
    try { motors = prepareFrameMotors(mount === undefined ? [rider] : [rider, mount], this.physics(to), { x: source.x - origin.x, z: source.z - origin.z }); }
    catch (error) { if (resident !== undefined) resident.reservations--; releaseHold?.(); throw error; }
    let closed = false;
    const frames = this.frames;
    let cancel: () => void = () => undefined;
    const finish = (): void => { closed = true; frames.delete(cancel); if (resident !== undefined) resident.reservations--; releaseHold?.(); };
    cancel = (): void => { if (closed) return; motors.cancel(); finish(); };
    this.frames.add(cancel);
    return { cancel, commit: () => {
      if (closed || this.disposed || this.active !== from || !this.ready(to)) throw new Error('Stale live frame commit');
      motors.commit();
      this.ports.player.motor = rider.motor; this.active = to;
      if (to !== null) this.forgetLastCell();
      this.ports.bindFrame({ instance: to, physics: this.physics(to), motor: rider.motor, origin });
      this.residents.get(to ?? '')?.lease.update({ needed: true }); this.residents.get(from ?? '')?.lease.update({ needed: to === null });
      this.crossings++; this.transitions.push({ from, to }); if (this.transitions.length > 256) this.transitions.shift(); finish();
    } };
    } finally { if (returning !== undefined) returning.reservations--; releaseReturn?.(); }
  }
  private retainedState(): Exclude<LiveGridState['retainedCell'], undefined> {
    const last = this.lastCell, policy = this.ports.lastCell;
    return last === null || policy === undefined ? null : { instance: last.instance, remainingMs: Math.max(0, last.until - diagnosticNow()),
      playingBytes: this.ports.allocator.ownerCost(last.instance).playing, capBytes: policy.playingBytes };
  }
  /** Read-only crossing evidence and failures for the real grid physics harness. */
  state(): LiveGridState { return { current: this.active, worldFeet: this.worldFeet(), crossings: this.crossings, ahead: { instance: this.ahead, warms: this.aheadBuilds }, transitions: this.transitions.map((row) => ({ ...row })), residents: [...this.residents.keys()].sort(), pending: [...new Set([...this.requests.keys(), ...this.folderRequests.keys()])].sort(), pendingWork: [
    ...[...this.requests.keys()].sort().map(instance => ({ instance, kind: 'world' as const, trigger: 'entry' as const })),
    ...[...this.folderRequests].sort(([a], [b]) => a.localeCompare(b)).map(([instance, request]) => ({ instance, kind: request.required ? 'required-metadata' as const : 'optional-metadata' as const, trigger: request.trigger })),
  ], issues: Object.fromEntries(this.issues), gameplayReady: this.active === null || this.ports.gameplayReady(this.active), ...(this.ports.lastCell === undefined ? {} : { retainedCell: this.retainedState() }), retirements: this.retirements.map(row => ({ ...row })), retiring: [...this.retiring.keys()], ghosts: { count: this.ghosts.count(), regions: this.ghosts.regions() } }; }
  /** Return the traveller to its page world before retiring regions. Failed disposals keep their full claims
   * and can be retried; the neutral highway disposer never owns the page physics or latest traveller motor. */
  dispose(): void {
    this.disposed = true;
    this.forgetLastCell();
    this.stopApproachTransport();
    this.tileMetadata.clear();
    for (const cancel of this.frames) cancel();
    // Return the still-live page traveller before freeing a world that contains its current controller.
    const page = null;
    if (this.active !== page) {
      const source = this.origin(this.active), origin = this.origin(page), physics = this.physics(page);
      const rider = { position: this.ports.player.position, motor: this.ports.player.motor }, mount = this.ports.mount?.();
      prepareFrameMotors(mount === undefined ? [rider] : [rider, mount], physics, { x: source.x - origin.x, z: source.z - origin.z }).commit();
      this.ports.player.motor = rider.motor; this.active = page;
      this.ports.bindFrame({ instance: page, physics, motor: rider.motor, origin });
    }
    const failures: unknown[] = [];
    // O20: a stepped retirement still running finishes now, before the residents' own disposal
    for (const record of this.retiring.values()) {
      try { for (let step = record.steps.next(); step.done !== true; step = record.steps.next()) { /* drained */ } this.finishRetirement(record, undefined); }
      catch (error) { this.finishRetirement(record, { error }); failures.push(error); }
    }
    for (const [instance, resident] of this.residents) {
      try { resident.region.dispose(); }
      catch (error) { resident.disposalFailed = true; resident.lease.update({ needed: true }); failures.push(error); continue; }
      this.residents.delete(instance); resident.lease.release();
    }
    for (const [instance, product] of this.products) {
      try { product.cancel?.(); this.products.delete(instance); } catch (error) { failures.push(error); }
    }
    if (!this.highwayDisposed) {
      try { this.highway.dispose(); this.highwayDisposed = true; this.highwayLease.release(); }
      catch (error) { failures.push(error); }
    }
    this.deferredFolders.clear(); this.deferredDemand.clear();
    if (failures.length > 0) throw new AggregateError(failures, 'Live grid disposal failed');
  }
}
