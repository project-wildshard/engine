import { Vector3, type PerspectiveCamera } from 'three';
import type { App } from '../app/app';
import type { LevelFrameBinding } from '../level/frame';
import type { AnimalFactory, AnimalKind } from './AnimalFactory';
import type { AnimalGroup } from './animalMatrices';
import type { Animal } from './AnimalView';
import { BOAR_TUNING, DEER_TUNING, fallbackSound, spawnRolls, type HuntHerd } from '../../../shared/engine/ai/huntPattern';
import type { SpeciesFlight } from '../../../shared/engine/ai/flight';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { SEED } from '../../../shared/engine/core/config';
import { frameCost } from '../../../shared/engine/core/frameCost';
import { Rng } from '../../../shared/engine/core/rng';
import { creatureFloor } from '../../../shared/engine/entities/creatureFloor';
import { EntityIds } from '../../../shared/engine/entities/ids';
import { poseEvery } from '../../../shared/engine/entities/poseCadence';
import { speciesDef, type EnemyWorld } from '../../../shared/engine/entities/species/registry';
import { activeLevel } from '../../../shared/engine/level/selection';
import { CreatureBodies } from '../../../shared/engine/physics/creatures';
import type { Physics } from '../../../shared/engine/physics/Physics';
import { heightAt } from '../../../shared/engine/world/Heightfield';

/** What draws the bodies (AnimalHerdView.ts): a rig, a batch, a shadow, a drop of blood. */
export interface RowBodiesDraw {
  readonly group: AnimalGroup;
  readonly factory: AnimalFactory;
  shadowBatch: boolean | null;
  debug: boolean;
  start: () => void;
  finish: () => void;
  park: () => void;
  show: () => void;
  inFrame: <T>(frame: LevelFrameBinding, run: () => T) => T;
  rig: (kind: AnimalKind, variant: string, rigSeed: number, seed: number, scale: number, id: string) => { actor: Animal; flight: SpeciesFlight | undefined };
  adopt: (a: Animal, player: Vector3, asleep: (a: Animal) => boolean) => void;
  hide: (a: Animal) => void;
  remove: (a: Animal) => void;
  trample: (animals: readonly Animal[], player: Vector3) => void;
  beginDraw: (camera: PerspectiveCamera | null) => void;
  reach: (a: Animal, from: Vector3, asleep: (a: Animal) => boolean) => void;
  draw: (a: Animal, index: number, distanceSquared: number) => void;
  endDraw: (animals: readonly Animal[], count: number, dt: number) => void;
  bloodBurst: (at: Vector3, dir: Vector3, strength: number) => void;
}
/** What the bodies read of the running app, live at each call: a region's frame swaps these under them. */
export type RowBodiesHost = Pick<App, 'combat' | 'events' | 'equipmentHost' | 'levelScope' | 'physics' | 'rng'>;
export interface RowBodyHit { animal: Animal; point: Vector3; distance: number; headshot: boolean; damage: number }
/** A herd as a view holds one: who stands in it, about where. The server's herds are law. */
export type RowHerd = HuntHerd<Animal>;

/** The far LOD distance of the per-frame animation (m). */
const ANIM_LOD = 140;
const _c = new Vector3(), _d = new Vector3(), _p = new Vector3(), _a = new Vector3(), _b = new Vector3();
/** Nothing here dozes: a body stands while the server sends its row. */
const awake = (): boolean => false;

/** Squared distance between a ray (o, d unit) and a segment a-b. */
function segRayDist2(o: Vector3, d: Vector3, a: Vector3, b: Vector3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, aox = a.x - o.x, aoy = a.y - o.y, aoz = a.z - o.z;
  const abab = abx * abx + aby * aby + abz * abz, abd = abx * d.x + aby * d.y + abz * d.z, aod = aox * d.x + aoy * d.y + aoz * d.z, abao = abx * aox + aby * aoy + abz * aoz;
  const den = abab - abd * abd, u = Math.min(1, Math.max(0, den > 1e-6 ? (abd * aod - abao) / den : 0));
  const t = Math.max(0, aod + u * abd), px = a.x + abx * u - (o.x + d.x * t), py = a.y + aby * u - (o.y + d.y * t), pz = a.z + abz * u - (o.z + d.z * t);
  return px * px + py * py + pz * pz;
}

/**
 * The creatures a page draws. Every one is a row's body: the server decides who exists, what each does and what a hit does, and a view reads
 * them here. A body poses from its row and animates; this holds no brain, no herd law and no decision (RETIRE-FEED row 6).
 */
export class RowBodies {
  animals: Animal[] = [];
  /** A view's herds, none of them law. */
  readonly herds: RowHerd[] = [];
  /** Every body here is a row's: a page makes none of its own. */
  herdless = true;
  /** Where the shard's ground is wet, as a view's placing asks. */
  wetAt: ((x: number, z: number) => boolean) | null = null;
  onKill?: (animal: Animal) => void;
  onSound?: (name: string, position: Vector3) => void;
  /** An authoritative attack's wind-up edge and real duration, delivered by the row adapter. */
  onWindup?: ((animal: Animal, dur: number) => void) | undefined;
  /** Own confirmed contacts (or local practice): amount, point, headshot and lethal marker. */
  onDamage?: (animal: Animal, amount: number, hitPoint: Vector3, headshot: boolean, died: boolean) => void;
  /** a dev's word and a room's: nothing on this page acts on it, and a view reads it back */
  calm = false;
  /** The shard's pieces a look reads. */
  enemyWorld: EnemyWorld = {};
  get habitat(): EnemyWorld { return this.enemyWorld; }
  set habitat(value: EnemyWorld) { this.enemyWorld = value; }
  /** An attack is coming from `a`, by its row: what the off-screen warning draws. */
  readonly isThreat = (a: Animal): boolean =>
    a.alive && !a.hidden && !a.stunned && (speciesDef(a.kind).phased === true ? a.attackPhase >= 0 && a.attackPhase < 1 : a.state === 'charge');
  private readonly draw: RowBodiesDraw;
  private readonly host: RowBodiesHost;
  /** A region's own physics; omitted, the page's. */
  private readonly physics: Physics | undefined;
  private readonly rng = new Rng(SEED + 31);
  private readonly entityIds = new EntityIds('creature');
  private readonly spawned = new WeakSet<Animal>();
  private readonly gone = new WeakSet<Animal>();
  private readonly deaths = new WeakMap<Animal, number>();
  private readonly playerPos = new Vector3();
  private bodies: CreatureBodies<Animal> | null = null;
  private hitResult: RowBodyHit | null = null;
  constructor(draw: RowBodiesDraw, host: RowBodiesHost, physics?: Physics) {
    this.draw = draw; this.host = host; this.physics = physics;
    const scope = host.levelScope;
    if (scope !== null) host.combat.registerTargets(scope, () => host.levelScope !== scope ? [] : this.animals.map(animal =>
      host.combat.targetPort(animal.combatActor(), animal, velocity => { animal.impulse(velocity); },
        () => !scope.disposed && host.levelScope === scope && !animal.hidden && animal !== host.equipmentHost?.player.mountedOn)));
  }
  get group(): AnimalGroup { return this.draw.group; }
  get factory(): AnimalFactory { return this.draw.factory; }
  get debug(): boolean { return this.draw.debug; }
  set debug(on: boolean) { this.draw.debug = on; }
  get shadowBatch(): boolean | null { return this.draw.shadowBatch; }
  set shadowBatch(batch: boolean | null) { this.draw.shadowBatch = batch; }
  get alive(): number { let n = 0; for (const a of this.animals) if (a.alive) n++; return n; }
  /** How many bodies have a physics body: the bench reads it. */
  get physicsBodies(): number { return this.bodies?.bodies ?? 0; }

  /** Build the level's species ahead of the first rows, a step at a time (`pause`), and their coats. A region passes its retained frame. */
  async build(pause: () => Promise<void>, frame?: LevelFrameBinding): Promise<this> {
    const { draw } = this, within = <T>(run: () => T): T => frame === undefined ? run() : draw.inFrame(frame, run);
    within(() => { draw.start(); });
    await draw.factory.ready;
    if (frame !== undefined) within(() => { draw.park(); });
    const steps = within(() => draw.factory.prepareSteps(activeLevel().spawns.flatMap(({ kind, variants }) => variants?.map(variant => ({ kind, variant })) ?? [{ kind }])));
    while (within(() => steps.next()).done !== true) await pause();
    await within(() => draw.factory.settled());
    return within(() => { draw.finish(); if (frame !== undefined) draw.show(); return this; });
  }
  retire(a: Animal): void {
    if (this.spawned.has(a) && this.animals.includes(a)) this.gone.add(a);
    a.hidden = true; this.draw.hide(a);
    if (!a.simulationBound) { a.alive = false; a.position.y = -9999; }
    const i = this.animals.indexOf(a); if (i !== -1) this.animals.splice(i, 1);
    this.bodies?.remove(a);
    a.retireBody();
    this.draw.remove(a);
  }
  /** Rebuild a body this page retired, keeping who it is. */
  replace(retired: Animal, x: number, z: number, yaw: number, variant?: string | string[], placement?: { y?: number; fromY?: number }): Animal {
    if (retired.simulationBound || !this.gone.has(retired) || this.animals.some(actor => actor.entityId === retired.entityId)) throw new Error('Replacement requires this page\'s unreplaced retired body');
    this.gone.delete(retired);
    return this.spawn(retired.kind, x, z, yaw, variant, { ...placement, entityId: retired.entityId });
  }
  addHerd(kind: string, cx: number, cz: number): number { this.herds.push({ kind, cx, cz, members: [] }); return this.herds.length - 1; }
  /** This page retired `actor`. */
  retired(actor: Animal): boolean { return this.gone.has(actor); }
  /** A body, at an exact height (a row's) or on the floor below `fromY`. */
  spawn(kind: AnimalKind, x: number, z: number, yaw: number, variant?: string | string[], placement?: { y?: number; fromY?: number; entityId?: string; body?: { seed: number; scale: number } }): Animal {
    if ((placement?.y !== undefined && !Number.isFinite(placement.y)) || (placement?.fromY !== undefined && !Number.isFinite(placement.fromY))) throw new Error('Creature spawn placement must be finite');
    const legendary = this.animals.some(a => a.kind === kind && a.rarity === 'legendary' && a.alive);
    const { variant: v, scale, rigSeed, seed } = spawnRolls(this.rng, kind, variant, legendary);
    const { actor: a, flight } = this.draw.rig(kind, v.id, rigSeed, placement?.body?.seed ?? seed, placement?.body?.scale ?? scale, this.entityIds.allocate(placement?.entityId));
    const sp = speciesDef(kind), level = activeLevel();
    a.maxHp = a.hp = v.hp ?? level.faunaTuning?.[kind]?.hp ?? sp.tuning?.hp ?? (sp.aggressive === true ? BOAR_TUNING : DEER_TUNING).hp;
    const physics = this.physics ?? this.host.physics;
    const fromY = placement?.fromY ?? Math.max(level.spawn.y ?? heightAt(x, z), heightAt(x, z)) + 1;
    const floor = creatureFloor(physics, x, z, fromY);
    a.place(x, z, yaw, placement?.y ?? (flight === undefined ? floor.y : flight.altitude + (flight.above === 'world' ? 0 : floor.y)));
    a.levelGround = floor.structure;
    if (level.ground.structures !== undefined || floor.structure || placement !== undefined) a.groundHeight = (px, pz, py) => creatureFloor(physics, px, pz, py).y;
    a.herd = -1;
    a.onFootfall = this.footfall;
    a.onDamaged = this.damaged;
    a.sampleTerrain();
    this.draw.adopt(a, this.playerPos, awake);
    this.animals.push(a);
    this.spawned.add(a);
    return a;
  }
  private readonly footfall = (a: Animal, strength: number): void => {
    if (this.onSound === undefined || a.position.distanceToSquared(this.playerPos) > 35 * 35) return;
    if (strength > 0.5) this.onSound('hoofsteps', a.position);
  };
  /** Each body's frame. `viewPos` is where it's seen from: the player, or Explore's free camera. `camera`: the far herd skips what's outside it. */
  update(dt: number, t: number, playerPos: Vector3, viewPos: Vector3 = playerPos, camera: PerspectiveCamera | null = null): void {
    this.playerPos.copy(playerPos);
    const { animals, draw } = this, n = animals.length;
    draw.trample(animals, playerPos);
    this.bodiesFor()?.sync(animals, playerPos, awake); // hitboxes posed from last frame's bones, handed out by distance
    draw.beginDraw(camera);
    const start = frameCost.on ? diagnosticNow() : 0;
    for (let i = 0; i < n; i++) {
      const a = animals[i];
      if (a === undefined) continue;
      draw.reach(a, viewPos, awake);
      if (a.hidden) continue;
      const d2 = a.position.distanceToSquared(viewPos);
      a.poseEvery = poseEvery(d2);
      if (!a.harnessHold && dt > 0) a.update(dt, t, d2 < ANIM_LOD * ANIM_LOD);
      draw.draw(a, i, d2);
    }
    if (frameCost.on) frameCost.sub('pose', start);
    draw.endDraw(animals, n, dt);
  }
  private bodiesFor(): CreatureBodies<Animal> | null {
    if (this.bodies === null) { const physics = this.physics ?? this.host.physics; if (physics !== null) this.bodies = new CreatureBodies<Animal>(physics); }
    return this.bodies;
  }
  /** Ray against every living body's hitboxes: the nearest hit, in an object reused between calls. */
  raycast(origin: Vector3, dir: Vector3, maxDist: number): RowBodyHit | null {
    const hit = this.bodiesFor()?.cast(origin, dir, maxDist, this.host.equipmentHost?.player.mountedOn ?? null) ?? null;
    if (hit === null) return null;
    const h = this.hitResult ??= { animal: hit.creature, point: new Vector3(), distance: 0, headshot: false, damage: 0 };
    h.animal = hit.creature; h.distance = hit.distance; h.headshot = hit.head; h.point.copy(hit.point);
    return h;
  }
  /** The living body a ray passes within `tol` m of, nearest along it: what the crosshair asks each frame. */
  nearRay(origin: Vector3, dir: Vector3, maxDist: number, tol: number): Animal | null {
    let best = maxDist, bestA: Animal | null = null;
    for (const a of this.animals) {
      if (!a.alive || a.hidden || a === this.host.equipmentHost?.player.mountedOn) continue;
      _c.copy(a.position); _c.y += a.dims.bodyY * a.scale;
      _d.subVectors(_c, origin);
      const t = _d.dot(dir);
      if (t < 0 || t > best) continue;
      const r = (a.dims.bodyHalfLen + a.dims.bodyRadius) * a.scale + tol;
      if (a.dims.fore === undefined && _d.lengthSq() - t * t > r * r) continue;
      a.headWorld(_p);
      const rh = a.dims.headRadius * a.scale + tol;
      _d.subVectors(_p, origin); const th = _d.dot(dir);
      let ok = th > 0 && _d.lengthSq() - th * th < rh * rh;
      if (!ok) { a.bodyCapsule(_a, _b); ok = segRayDist2(origin, dir, _a, _b) < (a.dims.bodyRadius * a.scale + tol) ** 2; }
      const fore = a.dims.fore;
      if (!ok && fore !== undefined && a.foreCapsule(_a, _b)) ok = segRayDist2(origin, dir, _a, _b) < (fore.radius * a.scale + tol) ** 2;
      if (ok) { best = t; bestA = a; }
    }
    return bestA;
  }
  /** Present an authoritative contact. Rows own health; only this player's contact gets numbers. */
  presentHit(a: Animal, amount: number, point: Vector3, head: boolean, killed: boolean, own: boolean): void {
    this.damaged(a, amount, point, point.clone().sub(this.playerPos).normalize(), killed, own, head, false);
  }
  /** Preserve the exact actor borrowed by quest and ecology listeners, without settling damage again. */
  presentDeath(a: Animal, dir: Vector3, amount: number, tick: number, own: boolean): void {
    if (this.deaths.get(a) === tick) return;
    this.deaths.set(a, tick);
    a.presentDeath(amount, a.position, dir);
    if (own) this.onKill?.(a);
    const actor = a.combatActor();
    this.host.events.emit('actor.died', { actor, req: { source: 'env', sourceTags: ['dmg.remote'], target: actor, amount,
      point: a.position.clone(), dir } });
  }
  /** The server already granted this owner's trophy; only its existing loose-pickup presentation runs here. */
  presentReward(a: Animal, player: string, item: string): void {
    this.host.events.emit('reward.granted', { player, coins: 0, body: a.entityId, item });
  }
  /** A blow this page settled: its blood, its cry and its numbers. */
  private readonly damaged = (a: Animal, amount: number, hitPoint: Vector3, dir: Vector3, died: boolean, own = true, head?: boolean, kill = true): void => {
    const sp = speciesDef(a.kind);
    if (sp.blood !== false) this.draw.bloodBurst(hitPoint, dir, amount >= 80 ? 1.5 : 1);
    this.onSound?.(sp.sounds?.hurt ?? fallbackSound(a.aggressive, 'hurt'), a.position);
    a.headWorld(_p);
    if (own) this.onDamage?.(a, amount, hitPoint, head ?? _p.distanceToSquared(hitPoint) < (a.dims.headRadius * a.scale + 0.06) ** 2, died);
    if (died && kill) this.onKill?.(a);
  };
}
/** What a view may read of them. */
export type RowBodiesView = Omit<RowBodies, 'build' | 'update' | 'presentHit' | 'presentDeath' | 'presentReward'> & Partial<Pick<RowBodies, 'presentHit' | 'presentDeath' | 'presentReward'>>;
