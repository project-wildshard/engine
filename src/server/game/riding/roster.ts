import type { FlockBrain } from '@wildshard/engine/ai/flock';
import type { AnimalSim, AnimalSimSpec } from '@wildshard/engine/entities/AnimalSim';
import { StalkerBrain } from '@wildshard/engine/ai/stalker';
import type { HuntBody } from '@wildshard/engine/ai/hunt';
import { Rng, type RngState } from '@wildshard/engine/core/rng';
import type { SimHost } from '@wildshard/engine/sim';
import { NativeActors } from '../population/actors';
import { creatureFloor, nativeCreatureRecipes } from '../shardfile/homeKeeper';
import { nativeHerdCollection } from '../shardfile/groupRuntime';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';

interface Services { readonly host: SimHost; readonly id: string; identities: NativeActors<HuntBody>; random: Rng; hunt: StalkerBrain<HuntBody>; bodies: HuntBody[]; sight: (boolean | null | undefined)[]; retired: Set<string>; flocks: readonly FlockBrain[] }
export interface MountSpawn { id: string; variant: string; seed: number; scale: number; at: [number, number, number]; yaw: number; adopted: RngState }
/** The same actor owns its dynamic identity, manager position and saved recipe. */
export interface BondedMount { body: MountSpawn; upgraded: boolean }
export interface BondedMountRows {
  id: string; services: string; herds: string; kind: string; variant: string; wildKinds: readonly string[];
  specs: readonly AnimalSimSpec[]; scale: readonly [number, number]; spawnY: number; program: unknown;
}
const installed = new WeakMap<SimHost, Map<string, BondedMountRoster>>();
/** Resolve the feature's actual native owner by row id. */
export function bondedMountRoster(host: SimHost, id: string): BondedMountRoster {
  const roster = installed.get(host)?.get(id); if (roster === undefined) throw new Error('Missing bonded mount roster'); return roster;
}
const sampleTerrain = (): void => undefined;

/** Server-safe one-companion roster. Admission and upgrade decisions come from
 * the guest, while allocation, native effects and retirement have one owner. */
export class BondedMountRoster {
  readonly records: BondedMount[] = [];
  readonly hidden: Set<string> = new Set<string>();
  private readonly program: ReturnProgram;
  private readonly spec: AnimalSimSpec;
  private readonly floor: ReturnType<typeof creatureFloor>;
  constructor(private readonly host: SimHost, private readonly rows: BondedMountRows, private readonly service: Services) {
    const { identities, random, hunt, bodies, sight } = service;
    if (service.host !== host || service.id !== rows.services || host.scope.disposed || host.scope.disposing
      || !(identities instanceof NativeActors) || !(random instanceof Rng) || !(hunt instanceof StalkerBrain)
      || bodies.length > 64 || bodies.length !== sight.length || bodies.some(actor => host.entities.get(actor.entityId) !== actor)) throw new Error('Invalid mount roster owners');
    const map = installed.get(host) ?? new Map<string, BondedMountRoster>(); if (map.has(rows.id)) throw new Error('Duplicate bonded mount roster');
    if ([...map.values()].some(roster => roster.rows.services === rows.services && roster.service !== service)) throw new Error('Duplicate mount roster owner');
    this.program = ReturnProgram.native(host, rows.program);
    this.spec = nativeCreatureRecipes(rows.specs).spec(rows.kind, rows.variant);
    this.floor = creatureFloor(host, (x, z) => host.groundHeightAt(x, z));
    if (rows.scale.some(value => !Number.isFinite(value) || value <= 0) || rows.scale[0] > rows.scale[1] || !Number.isFinite(rows.spawnY)) throw new Error('Invalid mount spawn rows');
    map.set(rows.id, this); installed.set(host, map); host.scope.onDispose(() => { map.delete(rows.id); });
  }
  get flocks(): readonly FlockBrain[] { return this.service.flocks; }
  get actors(): readonly HuntBody[] { return this.service.bodies; }
  owns(actor: AnimalSim): actor is HuntBody {
    return this.records.some(row => row.body.id === actor.entityId) && this.service.bodies.some(body => body === actor);
  }
  /** A bonded horse for a tamer who holds `bonds` already: the guest's one-companion rule is one each. */
  spawn(x: number, z: number, yaw: number, upgraded: boolean, bonds: number = this.records.length): HuntBody {
    const { identities, random } = this.service;
    const plan = this.program.project('bond', { x, z, bonds, elite: Number(upgraded) });
    if (!Number.isFinite(yaw) || plan['accept'] !== 1) throw new Error('Invalid bonded mount adoption');
    const id = identities.allocate(), scale = random.range(this.rows.scale[0], this.rows.scale[1]); random.next(); const seed = random.next();
    const terrain = this.host.groundHeightAt(x, z), at = this.floor(x, z, Math.max(this.rows.spawnY, terrain) + 1);
    const body: MountSpawn = { id, variant: this.rows.variant, seed, scale, at: [x, at.y, z], yaw, adopted: random.snapshot() };
    const actor = this.create(body, true);
    actor.place(x, z, yaw); actor.position.y = terrain; actor.mem['whistle'] = 1;
    const override = plan['scale']; if (override !== undefined && override > 0) actor.scale = override;
    this.records.push({ body, upgraded }); return actor;
  }
  /** Reinstall in the enclosing roster's global allocation order. Saved native
   * world replacement reconnects colliders later; no replacement is allocated. */
  materialize(body: MountSpawn): HuntBody { return this.create(body, false); }
  private create(body: MountSpawn, reserved: boolean): HuntBody {
    const { identities, bodies, sight, random, hunt } = this.service, allocator = identities.allocatorState();
    if (this.host.entities.size >= 64 || bodies.length >= 64 || this.host.entities.has(body.id) || body.variant !== this.rows.variant || body.scale <= 0) throw new Error('Invalid saved companion body');
    const known = identities.identity(body.id);
    if (known === null && !reserved) {
      const ordinal = Number(body.id.slice(body.id.lastIndexOf(':') + 1));
      if (!Number.isSafeInteger(ordinal) || ordinal < allocator.next) throw new Error('Invalid companion allocation order');
      identities.restoreAllocator({ next: ordinal, used: allocator.used });
      if (identities.allocate() !== body.id) throw new Error('Invalid companion identity');
    }
    const [x, y, z] = body.at;
    const actor = Object.assign(this.host.spawn({ id: body.id, spec: this.spec, seed: body.seed, scale: body.scale, at: { x, y, z }, yaw: body.yaw }), { hidden: false, sampleTerrain });
    actor.levelGround = y !== this.host.groundHeightAt(x, z);
    if (actor.levelGround) actor.groundHeight = (px, pz, fromY) => this.floor(px, pz, fromY + 1).y;
    identities.materialize({ id: body.id, kind: this.rows.kind, variant: this.rows.variant }, actor);
    bodies.push(actor); sight.push(false); random.restore(body.adopted); hunt.adopt(actor, x, z); return actor;
  }
  hide(id: string): void {
    const actor = this.host.entities.get(id);
    if (actor === undefined || !actor.alive || this.hidden.has(id) || !this.rows.wildKinds.includes(actor.kind)
      || !this.service.bodies.some(body => body === actor) || !nativeHerdCollection(this.host, this.rows.herds).herds.some(herd => herd.members.includes(actor) || herd.stallion === actor)) throw new Error('Foreign tamed mount');
    Object.assign(actor, { hidden: true }); actor.position.y = -1e4; actor.motor?.dispose(); actor.motor = null;
    const owner = this.service.identities.identity(id); if (owner !== null) this.service.identities.own(id, { ...owner, listed: false });
    this.host.bodyDt(id); this.host.brainDt(id); this.hidden.add(id);
  }
  /** J108: the wild pool fills the place a tamed horse left: a hidden body stands at (x, z), listed and wild again. */
  reveal(id: string, x: number, z: number, yaw: number): void {
    const actor = this.host.entities.get(id);
    if (actor === undefined || !this.hidden.delete(id)) throw new Error('Foreign wild return');
    Object.assign(actor, { hidden: false }); actor.mem['ridden'] = 0; actor.place(x, z, yaw);
    const owner = this.service.identities.identity(id); if (owner !== null) this.service.identities.own(id, { ...owner, listed: true });
  }
  retire(id: string): void {
    const actor = this.host.entities.get(id), record = this.records.findIndex(row => row.body.id === id), index = actor === undefined ? -1 : this.service.bodies.findIndex(body => body.entityId === id && body === actor);
    if (actor === undefined || record === -1 || index === -1 || actor.kind !== this.rows.kind || actor.variant !== this.rows.variant) throw new Error('Foreign bonded mount retirement');
    this.service.identities.retire(id); this.host.retire(id); const owned = this.service.bodies[index]; if (owned === undefined) throw new Error('Missing owned companion'); this.service.hunt.forget(owned);
    Object.assign(actor, { hidden: true }); actor.alive = false; actor.position.y = -1e4;
    this.service.bodies.splice(index, 1); this.service.sight.splice(index, 1); this.records.splice(record, 1); this.service.retired.add(id);
  }
}
