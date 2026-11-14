import type { SimCommand, SimHost, SimTickCommand } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { CharacterMotor } from '@wildshard/engine/physics/CharacterMotor';
import { snapshotSimHost, type SimSnapshot } from '@wildshard/engine/sim/snapshot';
import { prepareFrameMotors, type FrameMember } from '@wildshard/engine/physics/frame';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { entrywayStands } from '@wildshard/engine/physics/query';
import { mountedPlayerOf } from '@wildshard/engine/game/riding/native';
import type { GridAssembly, GridCell, GridPoint } from '../../../shared/game/grid/assembly';
import type { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { GridContinuationCache, GRID_CONTINUATION_CACHE_BYTES } from '../../../shared/game/grid/continuations';
import { gridBoardLimit } from '../../../shared/game/grid/rules';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** Admission returns one owned, renderer-free regional host; its world is always in authored local coordinates. */
export interface GridResident { readonly host: SimHost; readonly dispose: () => void }
/** Narrow adapter to the session's one residency allocator; bytes are charged only once. */
export interface GridSimLease { release: () => void; update?: (state: { needed?: boolean; distance?: number }) => void }
/** Durable snapshots and native/browser admission are injected; no network operation runs during a fixed tick. */
export interface GridSimulationPorts {
  readonly highway: GridResident;
  load: (cell: GridCell, saved: SimSnapshot | undefined) => Promise<GridResident>;
  save?: (instance: string, snapshot: SimSnapshot) => boolean;
  /**
   * An owner that keeps every continuation itself, and reloads them in `load` (E5.2b, a phone's worker). It captures an occupied
   * world when told to, in whatever form it stores. Nothing is captured on admission or packed in memory: capturing a whole
   * physics world grows a wasm heap that never gives it back, and a world nobody entered has nothing to keep.
   */
  durable?: (instance: string, host: SimHost) => boolean;
  read?: (instance: string) => SimSnapshot | undefined;
  admitted?: (instance: string) => boolean;
  beforeMove?: (instance: string | null, host: SimHost) => void;
  /** Additional traveling body, normally the ridden mount, retained by its gameplay owner. */
  mount?: () => FrameMember | undefined;
  invalidated?: (instance: string) => void;
  /** One session allocator owns sim and render budgets. Admission acquires its lease before constructing a world. */
  reserve?: (instance: string, bytes: number) => Promise<GridSimLease>;
  allocator?: ResidencyAllocator;
  distance?: (cell: GridCell) => number;
  residentBytes?: (cell: GridCell) => number;
  maxResidents?: number;
}
/** A synchronous, rollback-safe motor change, matching the crossing coordinator's transaction port. */
export interface PreparedGridFrame { commit: () => void; cancel: () => void }
/** Two-phase durable eviction; abort retains the world and commit retires only the prepared frozen residency. */
export interface PreparedGridUnload { commit: () => void; abort: () => void }
interface Resident { value: GridResident; touched: number; reservations: number; retained: boolean; evicting: boolean; lease: GridSimLease | undefined }

/** GRID-CROSSING GC34, ROAD-PRELOAD RP4: a crossing hands the walker to the destination's seat with the speed and the mode (foot,
 *  board, swim) they had, so a walk across the line never stops (it started from rest: RP1's ~0.3 s stop at x -260 while the page
 *  caught it up), and an owner's seat parked in that cell never mixes the new speed with the mode it was left in. The dedicated server's
 *  handover (`CrossTarget.admit`) carries the same. */
/**
 * GC15 (3): a walker's motion as plain data, for a crossing onto another worker (a message between threads carries no class), and
 * `applyMotion` puts it on the arrival body as `carryMotion` does on one worker. A swim's climb target stays behind.
 */
export interface MotionSnapshot {
  readonly board: { readonly on: boolean; readonly hoverAir: PlayerSim['board']['hoverAir']; readonly hoverBob: PlayerSim['board']['hoverBob'] };
  readonly swim: Omit<PlayerSim['swim'], 'climbTo'>; readonly footing: PlayerSim['footing']; readonly moveScale: number;
  readonly velocity: { readonly x: number; readonly y: number; readonly z: number }; readonly impulse: { readonly x: number; readonly y: number; readonly z: number };
  readonly grounded: boolean; readonly shove: PlayerSim['shove']; readonly dash: PlayerSim['dash']; readonly dodge: PlayerSim['dodge']; readonly jump: PlayerSim['jump'];
}
export function motionOf(from: PlayerSim): MotionSnapshot {
  const { climbTo: _climb, ...swim } = from.swim;
  return { board: { on: from.board.on, hoverAir: from.board.hoverAir, hoverBob: from.board.hoverBob }, swim: { ...swim }, footing: { ...from.footing }, moveScale: from.moveScale,
    velocity: { x: from.velocity.x, y: from.velocity.y, z: from.velocity.z }, impulse: { x: from.impulse.x, y: from.impulse.y, z: from.impulse.z }, grounded: from.fall.grounded,
    shove: { ...from.shove }, dash: { ...from.dash }, dodge: { ...from.dodge }, jump: { ...from.jump } };
}
export function applyMotion(from: MotionSnapshot, to: PlayerSim): void {
  if (to.board.on !== from.board.on) to.setBoard(from.board.on);
  to.board.hoverAir = from.board.hoverAir; to.board.hoverBob = from.board.hoverBob;
  Object.assign(to.swim, from.swim); Object.assign(to.footing, from.footing); to.moveScale = from.moveScale;
  to.velocity.set(from.velocity.x, from.velocity.y, from.velocity.z); to.impulse.set(from.impulse.x, from.impulse.y, from.impulse.z); to.fall.grounded = from.grounded;
  Object.assign(to.shove, from.shove); Object.assign(to.dash, from.dash); Object.assign(to.dodge, from.dodge); Object.assign(to.jump, from.jump);
}
export function carryMotion(from: PlayerSim, to: PlayerSim): void {
  if (to.board.on !== from.board.on) to.setBoard(from.board.on);
  to.board.hoverAir = from.board.hoverAir; to.board.hoverBob = from.board.hoverBob;
  Object.assign(to.swim, from.swim); Object.assign(to.footing, from.footing); to.moveScale = from.moveScale;
  to.velocity.copy(from.velocity); to.impulse.copy(from.impulse); to.fall.grounded = from.fall.grounded;
  Object.assign(to.shove, from.shove); Object.assign(to.dash, from.dash); Object.assign(to.dodge, from.dodge); Object.assign(to.jump, from.jump);
}

/**
 * Independent local physics worlds; only a world with a player in it advances, while visible neighbours remain frozen.
 * Each player crosses on their own (P1-E3.9). `owner` is the player this session was built around, the lead of every host:
 * its systems bind to that seat, so when it leaves others behind the seat stays, parked, and a lone player never parks.
 */
export class GridSimulation {
  /** Where each player is: a cell's instance, or null for the highway. */
  private readonly sites = new Map<string, string | null>();
  private readonly owner: string;
  private readonly residents = new Map<string, Resident>();
  private readonly snapshots = new GridContinuationCache();
  private cacheLease: GridSimLease | undefined;
  private readonly requests = new Map<string, Promise<void>>();
  private readonly cancelFrames = new Set<() => void>();
  private readonly cleanupIssues: string[] = [];
  private sequence: Promise<void> = Promise.resolve();
  private used = 0;
  private disposed = false;
  private readonly limit: number;
  readonly assembly: GridAssembly;
  private readonly ports: GridSimulationPorts;
  constructor(assembly: GridAssembly, ports: GridSimulationPorts) {
    this.assembly = assembly; this.ports = ports;
    this.limit = ports.maxResidents ?? 4;
    const owner = leadPlayer(ports.highway.host);
    if (!Number.isInteger(this.limit) || this.limit < 1 || this.limit > 9 || ports.highway.host.embedded || !owner.hasMotor) throw new RangeError('Invalid grid simulation owner');
    this.owner = owner.id; this.sites.set(owner.id, null);
    if (ports.reserve !== undefined && ports.residentBytes === undefined) throw new Error('Sim reservation needs admitted resident bytes');
    if (ports.allocator !== undefined && (ports.residentBytes === undefined || ports.reserve !== undefined)) throw new Error('Use one sim reservation owner with admitted bytes');
  }
  /** Stable active instance; null is the platform highway/strip frame. */
  current(player: string = this.owner): string | null {
    const site = this.sites.get(player);
    if (site === undefined) throw new Error(`Not on the grid: ${player}`);
    return site;
  }
  /** The host a player stands in, which holds that player's enabled capsule and character controller. */
  host(player: string = this.owner): SimHost { return this.hostAt(this.current(player)); }
  /** The host of a world, resident or the highway. */
  hostOf(site: string | null): SimHost { return this.hostAt(site); }
  private hostAt(site: string | null): SimHost { return site === null ? this.ports.highway.host : this.resident(site).value.host; }
  /** Whether any player stands in this cell, so it advances and cannot be evicted. */
  private occupied(site: string | null): boolean { for (const at of this.sites.values()) if (at === site) return true; return false; }
  /** Everyone on the grid. */
  players(): readonly string[] { return [...this.sites.keys()]; }
  private seat(host: SimHost, player: string): PlayerSim {
    const seat = host.players.get(player);
    if (seat === undefined) throw new Error(`No grid seat for ${player}`);
    return seat;
  }
  /** Another player comes onto the highway, already free of any cell, or stands in the world at `site`. */
  join(player: string, at: Readonly<GridPoint>, yaw = 0, site: string | null = null): void {
    if (this.disposed || this.sites.has(player)) throw new Error('Invalid grid player');
    const host = this.hostAt(site);
    this.parkOwner(host); host.addPlayer(player, at, yaw); this.sites.set(player, site);
  }
  /** A player other than the owner leaves the grid, from wherever it stands. */
  leave(player: string): boolean {
    const site = this.sites.get(player);
    if (site === undefined || player === this.owner) return false;
    const host = this.hostAt(site);
    this.sites.delete(player); host.removePlayer(player); this.settleOwner(host, site);
    return true;
  }
  /** A host about to run without its lead keeps the lead's seat, its capsule disabled, for the systems bound to it. */
  private parkOwner(host: SimHost): void {
    const seat = this.seat(host, this.owner);
    if (seat.hasMotor) return;
    const capsule = new CharacterMotor(host.physics, host.playerMotorOptions(seat));
    capsule.setEnabled(false); capsule.resetAt(seat.position); seat.attachMotor(capsule); host.parked.add(seat.id);
  }
  /** A host nobody is left in freezes as any region does: its lead's seat holds no capsule. */
  private settleOwner(host: SimHost, site: string | null): void { if (!this.occupied(site)) this.unparkOwner(host); }
  private unparkOwner(host: SimHost): void { if (host.parked.delete(this.owner)) this.seat(host, this.owner).detachMotor(); }
  private resident(instance: string): Resident { const value = this.residents.get(instance); if (value === undefined) throw new Error(`Grid sim is not resident: ${instance}`); return value; }
  /** Resolve a pure target using the 6 m enter / 10 m leave bands, both within the 20 m strip. */
  target(feet: Readonly<GridPoint>, player: string = this.owner): string | null {
    if (![feet.x, feet.y, feet.z].every(Number.isFinite)) throw new RangeError('Invalid grid feet');
    const distance = (cell: GridCell): number => Math.max(Math.abs(feet.x - cell.origin.x), Math.abs(feet.z - cell.origin.z)) - CHUNK_HALF;
    const active = this.current(player);
    if (active !== null && distance(this.assembly.cell(active)) <= 10) return active;
    return [...this.assembly.cells].sort((a, b) => a.instance.localeCompare(b.instance)).find((cell) => distance(cell) <= 6)?.instance ?? null;
  }
  /** Physics construction is not enough when the runtime/admitted closure has an additional readiness fence. */
  ready(instance: string | null): boolean { return !this.disposed && (instance === null || (this.residents.has(instance) && !this.resident(instance).evicting && (this.ports.admitted?.(instance) ?? true))); }
  /** Whole-shard admission runs in a stable instance order; requests are deduplicated while in flight. */
  prefetch(instances: readonly string[]): Promise<void> {
    return Promise.all([...new Set(instances)].sort().map((instance) => this.ensure(instance))).then(() => undefined);
  }
  private ensure(instance: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Grid simulation is disposed'));
    this.assembly.cell(instance);
    const existing = this.residents.get(instance);
    if (existing !== undefined) { existing.touched = ++this.used; return Promise.resolve(); }
    const pending = this.requests.get(instance); if (pending !== undefined) return pending;
    const request = this.sequence.then(() => this.admit(instance));
    this.requests.set(instance, request); this.sequence = request.catch(() => undefined);
    void request.finally(() => { this.requests.delete(instance); }).catch(() => undefined);
    return request;
  }
  private async admit(instance: string): Promise<void> {
      this.assertAlive();
      await this.reserveCache();
      while (this.residents.size >= this.limit) {
        const candidate = [...this.residents].filter(([id, value]) => !this.occupied(id) && value.reservations === 0 && !value.retained).sort((a, b) => a[1].touched - b[1].touched || a[0].localeCompare(b[0]))[0];
        if (candidate === undefined || !this.unload(candidate[0])) throw new Error('No durable frozen grid residency can be evicted');
      }
      const cell = this.assembly.cell(instance), bytes = this.ports.residentBytes?.(cell) ?? 0;
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('Invalid admitted sim resident cost');
      let lease: GridSimLease | undefined;
      if (this.ports.allocator !== undefined) {
        const claim = this.ports.allocator.reserve({ id: `sim:${instance}`, category: 'sim', owner: instance, bytes, distance: this.ports.distance?.(cell) ?? 0, needed: true, prepareEvict: () => this.prepareUnload(instance) });
        if (claim === null) throw new Error('Sim residency admission deferred by the shared budget');
        lease = claim;
      } else lease = await this.ports.reserve?.(instance, bytes);
      let value: GridResident;
      try { value = await this.ports.load(cell, this.snapshots.read(instance) ?? this.ports.read?.(instance)); } catch (error) { lease?.release(); throw error; }
      try {
        if (this.disposed || value.host.embedded || !value.host.players.get(this.owner)?.hasMotor) throw new Error('Grid admission requires an owned host');
        // A save holds whoever stood here when it was made; they carry themselves now, and nobody stands here yet.
        for (const id of value.host.players.keys()) if (id !== this.owner) value.host.removePlayer(id);
        const checkpoint = this.ports.durable === undefined ? this.snapshots.pack(instance, snapshotSimHost(value.host)) : undefined;
        if (checkpoint === null) throw new Error('Grid continuation cache capacity exceeded');
        this.seat(value.host, this.owner).detachMotor();
        if (checkpoint !== undefined) this.snapshots.store(instance, checkpoint);
        this.residents.set(instance, { value, touched: ++this.used, reservations: 0, retained: false, evicting: false, lease });
        lease?.update?.({ needed: false });
      } catch (error) { try { value.dispose(); } finally { lease?.release(); } throw error; }
      return undefined;
  }
  private assertAlive(): void { if (this.disposed) throw new Error('Grid simulation is disposed'); }
  /** The optional session budget owner charges a fixed packed pool before any regional world is allocated. */
  private async reserveCache(): Promise<void> {
    if (this.cacheLease !== undefined) return;
    const id = 'sim-continuations:node';
    let lease: GridSimLease | undefined;
    if (this.ports.allocator !== undefined) {
      if (this.ports.allocator.has(id)) throw new Error('Grid continuation cache already has an owner');
      const claim = this.ports.allocator.reserve({ id, category: 'sim', owner: 'platform', bytes: GRID_CONTINUATION_CACHE_BYTES, distance: 0, needed: true });
      if (claim === null) throw new Error('Grid continuation cache admission deferred by the shared budget');
      lease = claim;
    } else lease = await this.ports.reserve?.(id, GRID_CONTINUATION_CACHE_BYTES);
    if (this.disposed) { lease?.release(); throw new Error('Grid simulation is disposed'); }
    this.cacheLease = lease;
  }
  /** Snapshot before leaving the active region. Failure keeps both its world and the traveller authoritative. */
  checkpoint(instance: string): boolean {
    const resident = this.residents.get(instance); if (resident === undefined || this.disposed) return false;
    if (this.ports.durable !== undefined) return !this.occupied(instance) || this.ports.durable(instance, resident.value.host);
    const snapshot = this.occupied(instance) ? snapshotSimHost(resident.value.host) : this.snapshots.read(instance);
    if (snapshot === undefined) throw new Error('Missing admitted grid continuation');
    const packed = this.snapshots.pack(instance, snapshot); if (packed === null) return false;
    if (this.ports.save?.(instance, snapshot) !== true) return false;
    this.snapshots.store(instance, packed); return true;
  }
  /** Readiness keeps a frozen destination resident; unneeded neighbours may be evicted by the shared allocator. */
  retain(instance: string, needed: boolean, distance: number): void {
    if (!Number.isFinite(distance) || distance < 0) throw new RangeError('Invalid sim residency distance');
    const resident = this.resident(instance); resident.retained = needed;
    resident.lease?.update?.({ distance, needed: needed || this.occupied(instance) || resident.reservations > 0 });
  }
  /** Dispose only a frozen region after its local continuation is durably retained. */
  unload(instance: string): boolean {
    const resident = this.residents.get(instance);
    if (resident === undefined) return true;
    const prepared = this.prepareUnload(instance); if (prepared === null) return false;
    prepared.commit(); return true;
  }
  /** Fallible checkpoints run before the allocator retires any claim. An aborted multi-claim eviction changes no world. */
  prepareUnload(instance: string): PreparedGridUnload | null {
    const resident = this.residents.get(instance);
    if (resident === undefined || this.disposed || this.occupied(instance) || resident.reservations !== 0 || resident.retained || resident.evicting) return null;
    try { if (!this.checkpoint(instance)) return null; } catch { return null; }
    resident.evicting = true;
    let closed = false;
    return {
      commit: () => {
        if (closed) return; closed = true;
        if (this.disposed || this.residents.get(instance) !== resident) return;
        this.residents.delete(instance);
        if (this.ports.read !== undefined) this.snapshots.drop(instance);
        // Each cleanup runs even if another fails. The infallible allocator commit exposes failures for the session owner.
        for (const dispose of [() => { this.ports.invalidated?.(instance); }, () => { resident.value.dispose(); }, () => { resident.lease?.release(); }]) {
          try { dispose(); } catch (error) { this.cleanupIssues.push(`${instance}: ${error instanceof Error ? error.message : String(error)}`); }
        }
      },
      abort: () => { if (closed) return; closed = true; resident.evicting = false; },
    };
  }
  /** A session owner must surface failed disposal; allocator commits remain atomic and never hide these errors. */
  disposalIssues(): readonly string[] { return [...this.cleanupIssues]; }
  /** Admission and disabled replacement controllers are prepared ahead of the fixed-step boundary. */
  async prepare(from: string | null, to: string | null, player: string = this.owner): Promise<PreparedGridFrame> {
    if (this.disposed || this.sites.get(player) !== from || from === to) throw new Error('Stale grid frame preparation');
    if (to !== null) await this.ensure(to);
    if (!this.ready(null) || this.sites.get(player) !== from) throw new Error('Stale grid frame preparation');
    if (to !== null && this.resident(to).evicting) throw new Error('Destination eviction is prepared');
    const source = this.hostAt(from), destination = this.hostAt(to);
    const traveller = this.seat(source, player);
    const fromOrigin = from === null ? { x: 0, z: 0 } : this.assembly.cell(from).origin, toOrigin = to === null ? { x: 0, z: 0 } : this.assembly.cell(to).origin;
    const rider: FrameMember = { position: traveller.position, motor: traveller.motor }, mount = player === this.owner ? this.ports.mount?.() : undefined;
    const transaction = prepareFrameMotors(mount === undefined ? [rider] : [rider, mount], destination.physics, { x: fromOrigin.x - toOrigin.x, z: fromOrigin.z - toOrigin.z });
    const target = to === null ? undefined : this.resident(to); if (target !== undefined) target.reservations++;
    target?.lease?.update?.({ needed: true });
    let closed = false;
    const cancellations = this.cancelFrames;
    function cancel(): void { if (closed) return; transaction.cancel(); release(); }
    const stillNeeded = (): boolean => this.occupied(to) || (target?.retained ?? false);
    function release(): void { closed = true; cancellations.delete(cancel); if (target !== undefined) { target.reservations--; target.lease?.update?.({ needed: target.reservations > 0 || stillNeeded() }); } }
    this.cancelFrames.add(cancel);
    return {
      commit: () => {
        if (closed || this.disposed || this.sites.get(player) !== from || !this.ready(to)) throw new Error('Stale or unready grid frame commit');
        const health = traveller.health.snapshot(), arrival = this.arrivalSeat(destination, player, traveller);
        // Validate before any source motor is retired; restore is bounded and cannot invoke application callbacks.
        arrival.health.restore({ ...health, lastHurt: health.lastHurt + (destination.clock.now - source.clock.now) * 1000 });
        transaction.commit(); traveller.releaseMotor(); arrival.attachMotor(rider.motor);
        arrival.position.copy(rider.position); arrival.yaw = traveller.yaw;
        if (arrival !== traveller) carryMotion(traveller, arrival);
        if (to !== null) landOnGround(destination, arrival);
        this.sites.set(player, to);
        if (player !== this.owner) source.removePlayer(player);
        if (this.occupied(from)) { if (player === this.owner) this.parkOwner(source); } else this.unparkOwner(source);
        release();
        if (from !== null) { const previous = this.resident(from); previous.lease?.update?.({ needed: previous.retained || previous.reservations > 0 || this.occupied(from) }); }
      },
      cancel,
    };
  }
  /**
   * Start a session in a cell rather than on the highway: before any tick, the owner takes the seat that cell holds for them,
   * at the pose, heading and health it holds, which is the cell's own spawn or the save it restored. Nothing has run yet, so
   * this is no crossing and hears no `travel`. Build the room after it: a crossing starts from where its player stands.
   */
  async enter(instance: string): Promise<void> {
    if (this.current() !== null) throw new Error('Grid owner has already entered');
    await this.ensure(instance);
    const road = this.ports.highway.host, cell = this.hostAt(instance), traveller = this.seat(road, this.owner), held = this.seat(cell, this.owner), health = held.health.snapshot();
    const { x, y, z } = this.assembly.world(held.position, this.assembly.cell(instance));
    traveller.health.restore({ ...health, lastHurt: health.lastHurt + (road.clock.now - cell.clock.now) * 1000 });
    traveller.position.set(x, y, z); traveller.yaw = held.yaw; traveller.motor.resetAt(traveller.position);
    (await this.prepare(null, instance)).commit();
  }
  /** A seat's board cap, read in world space from wherever it stands: a resident host's feet are its cell's (P1-E5.3-A10). */
  private boardLimit(player: string): number {
    const site = this.current(player), seat = this.seat(this.hostAt(site), player), { assembly } = this;
    const feet = site === null ? seat.position : assembly.world(seat.position, assembly.cell(site));
    const p = assembly.pitch, cx = Math.round(feet.x / p), cz = Math.round(feet.z / p), cell = assembly.cells.find(row => row.cell[0] === cx && row.cell[1] === cz);
    return gridBoardLimit({ local: { x: feet.x - cx * p, y: feet.y, z: feet.z - cz * p }, shardCap: 14, onHighwayDeck: feet.y < 4,
      speedClass: cell?.speedClass ?? 'shard' });
  }
  /** The empty seat a player takes on arrival. The lead's is always there; anyone else's is made for them. */
  private arrivalSeat(host: SimHost, player: string, traveller: PlayerSim): PlayerSim {
    if (player === this.owner) { this.unparkOwner(host); return this.seat(host, player); }
    this.parkOwner(host);
    const seat = host.addPlayer(player, traveller.position, traveller.yaw);
    seat.detachMotor();
    return seat;
  }
  /** Run once after the crossing coordinator; no frozen neighbour's clock, creatures, scripts or quests advance. */
  step(command?: SimCommand): void { this.stepAll(command === undefined ? undefined : new Map([[this.owner, command]])); }
  /** One tick for every world with a player in it: each player's command goes to the host it stands in. */
  stepAll(commands?: ReadonlyMap<string, SimTickCommand>): void {
    if (this.disposed) throw new Error('Grid simulation is disposed');
    for (const [player, site] of this.sites) this.seat(this.hostAt(site), player).hoverSpeedLimit ??= () => this.boardLimit(player);
    const sites = new Set(this.sites.values());
    for (const site of sites) {
      const host = this.hostAt(site); this.ports.beforeMove?.(site, host);
      if (sites.size === 1) { host.step(commands); continue; }
      const own = new Map<string, SimTickCommand>();
      for (const [id, command] of commands ?? []) if (this.sites.get(id) === site) own.set(id, command);
      host.step(own);
    }
  }
  /** One tick of one world, for a room stepping its own (`stepAll` does every world). */
  stepSite(site: string | null, commands: ReadonlyMap<string, SimTickCommand>): void {
    if (this.disposed) throw new Error('Grid simulation is disposed');
    const host = this.hostAt(site); this.ports.beforeMove?.(site, host); host.step(commands);
  }
  /** Every world with a player in it. */
  occupiedSites(): ReadonlySet<string | null> { return new Set(this.sites.values()); }
  /** Global render pose is derived from local feet and the current frame, never saved into an authored host. */
  worldFeet(player: string = this.owner): GridPoint {
    const site = this.current(player), { position } = this.seat(this.hostAt(site), player);
    return site === null ? { x: position.x, y: position.y, z: position.z } : this.assembly.world(position, this.assembly.cell(site));
  }
  /** Packed same-page continuations stay bounded independently of the number of unloaded native worlds. */
  continuationState(): { entries: number; storedChars: number; capacityChars: number; claimedBytes: number } {
    return { ...this.snapshots.state(), claimedBytes: this.cacheLease === undefined ? 0 : GRID_CONTINUATION_CACHE_BYTES };
  }
  /** Close all worlds owned by this session; async admissions dispose their own late results. */
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    const cleanups = [...this.cancelFrames, ...[...this.residents.values()].flatMap((resident) => [() => { resident.value.dispose(); }, () => { resident.lease?.release(); }]), () => { this.ports.highway.dispose(); }, () => { this.cacheLease?.release(); this.cacheLease = undefined; }];
    for (const cleanup of cleanups) {
      try { cleanup(); } catch (error) { this.cleanupIssues.push(error instanceof Error ? error.message : String(error)); }
    }
    this.residents.clear(); this.cancelFrames.clear(); this.snapshots.clear();
    if (this.cleanupIssues.length > 0) throw new AggregateError(this.cleanupIssues, 'Grid simulation disposal failed');
  }
}

/**
 * GRID-CROSSING GC30b (QA-FEEDBACK-2026-11-13 row 11, J322 "there should never be any walls"): a walker who crosses into a cell whose
 * entryway on that side has no ground of its own (Far Reach's sky islands: Jake walked south off the road at y 0 and fell) is set down
 * on the first ground they can stand on, the cell's own spawn, never left hanging in the air. Its solids may be held near its lead
 * (`NearColliders`), so they are brought up at the entryway before the probe and at the spawn after the move.
 */
export function landOnGround(host: SimHost, seat: PlayerSim): boolean {
  const { position } = seat, near = host.physics.near;
  // only a walker at the cell's edge, off the road: an `enter` sets down a saved pose inside the cell, where it stood before
  if (Math.max(Math.abs(position.x), Math.abs(position.z)) < CHUNK_HALF - 10) return false;
  near?.update(position.x, position.z);
  if (entrywayStands(host.physics, position.x, position.z)) return false;
  const { at, yaw } = host.level.player, mounted = mountedPlayerOf(host, seat.id);
  // a rider and their horse go together, as a harness's `place` moves them
  if (mounted?.mounted === true) mounted.teleport(at.x, at.z, yaw); else seat.resetPose(at, yaw);
  near?.update(at.x, at.z);
  return true;
}
