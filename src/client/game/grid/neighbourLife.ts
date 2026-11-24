/**
 * A cell's client life (SHARD-PLATFORM SF25 render side): a shardfile cell gets its creatures drawn in its cell root (the
 * SF9c skins, following its regional host's authoritative entities): the ones its `clientScripts` bind, and in a data cell
 * (no runtime, no declared client page: the templates) every spawn with a skin look, bound or not (TEMPLATE-E2E TC-E1a:
 * Brasscap binds only particles, so its bandits were never drawn). A cell that declares `clientScripts` also gets its own
 * isolated client lane (`createShardfileClientScripts`, sp-x5) stepped on the page's fixed tick; `ClientScriptViews`
 * composes its frames on top of the views and draws its particles. A lane that fails to build leaves the creatures drawn.
 * Nothing here writes a simulation.
 *
 * Only while the traveller is inside the cell (G663, tile streaming T7: a neighbour is scene-graph level of detail, with
 * no logic or runtime; it replaced G66's "frozen, but alive-looking" neighbours): a frozen cell's lane never steps and its
 * creatures stay hidden, so a neighbour shows only its tiles.
 */
import { Bone, Skeleton, SkinnedMesh, Vector3, type Group, type Object3D } from 'three';
import { CreatureSockets } from '../../../shared/game/shardfile/creatureSockets';
import type { CreatureLockPoints, CreatureVolumePose } from '@wildshard/engine/physics/creatureVolumes';
import { creatureScale } from '@wildshard/format/creatureSizes';
import { addCombatTargets, reportCombatHit, type CombatTarget } from '@wildshard/engine/ui/Combat';
import { addAimTargets, type AimTarget } from '@wildshard/engine/player/AimTargets';
import type { Scope } from '@wildshard/engine/app/scope';
import { createShardfileClientScripts } from '../shardfile/clientScripts';
import type { ClientScriptTarget } from '@wildshard/format/clientScripts';
import { loadClientSkins, clientVariantSkin, creatureGunfire, SerpentDeath, SkinDriver, type ClientSkin, type SkinDriveState } from '../shardfile/clientSkins';
import { ClientScriptViews, type ClientScriptViewTarget, type ClientScriptViewState } from "../plugin/ui";
import type { Shardfile } from '@wildshard/format/shardSchema';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import type { GridCell } from '../../../shared/game/grid/assembly';
import { TrailCreatureVolumes } from '../../../shared/game/shardfile/trailCreatureVolumes';
import { TRAIL_SAMPLE_TICKS } from '@wildshard/engine/entities/trailBones';

/** One creature as a view draws it (E6): a page reads the region's sim entity, a client reads its row. */
export interface NeighbourCreature {
  readonly hitVolumes?: CreatureVolumePose | undefined;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number; readonly scale: number; readonly speed: number; readonly strafe: number;
  readonly alive: boolean; readonly attackPhase: number; readonly state: SkinDriveState['state'];
  /** The row's hp and flinch (absent on a source that sends neither): a fall in hp is a blow, whoever landed it. */
  readonly hp?: number; readonly flinch?: number;
  /** ONE-FORMAT CC27: the tick this row is drawn at, and the row's root at an earlier whole tick (null when the source no
   *  longer holds it). A serpent's view feeds its own trail ring from these on the 10 Hz sample ticks, as the server does. */
  readonly tick?: number;
  readonly rootAt?: (tick: number) => { readonly x: number; readonly y: number; readonly z: number } | null;
}
/** A cell's admitted region, as much of it as a view reads. */
export interface NeighbourRegion { readonly host: { readonly entities: { get: (id: string) => NeighbourCreature | undefined } } }
/** What a cell's life reads from the session: its admitted region (absent until the live host admits it) and whether it is the active frame. */
export interface NeighbourLifePorts {
  readonly scope: Scope;
  readonly simulation: (instance: string) => NeighbourRegion | undefined;
  readonly active: (instance: string) => boolean;
  /** A public shared state field the server sends for the cell, by its declared name: only where the wire stands (TC-SHIP-d2:
   *  Brasscap's Wyrm glows its gullet and tells its strike from these; a lane with no state view refused the whole cell). */
  readonly field?: (instance: string, name: string) => number | undefined;
}
/** One cell's readout. */
export interface NeighbourLifeCell { readonly instance: string; readonly creatures: number; readonly frozen: boolean; readonly views: ClientScriptViewState; readonly failed: string | null }

/** TEMPLATE-E2E TC-B10: a drawn creature as the page's health bars read it (Combat's `CombatTarget`), in world space. */
class CreatureTarget implements CombatTarget, AimTarget {
  lockPoints: CreatureLockPoints | undefined;
  hidden = true; lastHitT = -Infinity; hp: number; maxHp: number; alive = true; scale: number; lastHp: number | null = null;
  readonly mem: Readonly<Record<string, number | undefined>> = {};
  readonly position = new Vector3();
  constructor(readonly kind: string, readonly label: string, maxHp: number, scale: number, private readonly head: number,
    readonly dims: { readonly bodyY: number; readonly bodyRadius: number }, readonly lockable: boolean) { this.hp = maxHp; this.maxHp = maxHp; this.scale = scale; }
  headWorld(out: Vector3): Vector3 { return out.copy(this.position).setY(this.position.y + this.head * this.scale); }
}
interface CreatureView { readonly id: string; readonly mesh: SkinnedMesh; readonly bones: Record<string, Bone>; readonly driver: SkinDriver; readonly spawn: { at: readonly [number, number, number]; yaw: number; scale: number }; readonly bodyY: number; readonly target: CreatureTarget; t: number; phase: number; readonly trail?: ViewTrail }
/** A serpent's page-side trail (CC27): its ring fed from the row's roots on the sample ticks, posed on the drawn root. */
interface ViewTrail { readonly volumes: TrailCreatureVolumes; readonly root: { readonly position: Vector3; yaw: number; scale: number }; last: number; readonly death: SerpentDeath }
/** A gap longer than this (a page hidden, a row out of relevance) lays a fresh rest trail instead of catching up. */
const TRAIL_CATCH_UP = 60;
interface CellLife {
  readonly cell: GridCell; readonly root: Group; readonly creatures: ReadonlyMap<string, CreatureView>;
  /** null: the cell binds no script (or its lane failed to build, `failed` says why); its creatures still draw */
  lane: { readonly scripts: ReturnType<typeof createShardfileClientScripts>; readonly views: ClientScriptViews } | null; failed: string | null;
}

/** A static view of one skin: the factory's bone layout (positions relative to the parent), bound once. */
function skinMesh(skin: ClientSkin): { mesh: SkinnedMesh; bones: Record<string, Bone> } {
  // TE-ENG10: a skin's mapped parts draw its geometry's groups 1..n in their own look materials
  const mesh = new SkinnedMesh(skin.geometry, skin.parts.length === 0 ? skin.material() : [skin.material(), ...skin.parts.map((part) => part())]), bones: Record<string, Bone> = {}, list: Bone[] = [];
  for (const def of skin.bones) {
    const parent = def.parent === null ? null : skin.bones.find((b) => b.name === def.parent) ?? null;
    const bone = new Bone();
    bone.name = def.name; bone.position.set(def.pos[0] - (parent?.pos[0] ?? 0), def.pos[1] - (parent?.pos[1] ?? 0), def.pos[2] - (parent?.pos[2] ?? 0));
    bones[def.name] = bone; list.push(bone);
    const holder = parent === null ? mesh : bones[parent.name];
    if (holder === undefined) throw new Error(`neighbour life: skin ${skin.id} lists ${def.name} before its parent`);
    holder.add(bone);
  }
  mesh.updateMatrixWorld(true); mesh.bind(new Skeleton(list));
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.name = `neighbour-creature:${skin.id}`;
  const sphere = skin.geometry.boundingSphere; if (sphere !== null) mesh.boundingSphere = sphere.clone();
  return { mesh, bones };
}

/** The cells' client lives: one per shardfile cell that declares client scripts, alive only while entered; disposed with the scope. */
export class NeighbourLife {
  private readonly ports: NeighbourLifePorts;
  private readonly cells = new Map<string, CellLife>();
  private tick = 0;
  constructor(ports: NeighbourLifePorts) {
    this.ports = ports;
    // TC-B10: the entered cell's drawn creatures get the page's health bars and damage numbers (Jake, 2026-11-15)
    // and the touch aim assist and lock-on: on a phone the thumb lands shots on them as on a page's own creatures
    ports.scope.onDispose(addCombatTargets(() => this.targets()));
    ports.scope.onDispose(addAimTargets(() => this.targets()));
  }

  /** The live, entered cells' creature targets, for the page's health bars. */
  private *targets(): Generator<CreatureTarget> {
    for (const life of this.cells.values()) if (this.ports.active(life.cell.instance)) for (const view of life.creatures.values()) yield view.target;
  }

  /** Admit one neighbour's life once its product and materials are ready (the session's shared per-slug load). */
  async admit(cell: GridCell, root: Group, source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, compile: Parameters<typeof loadClientSkins>[2], skinsBySlug: Map<string, Promise<ReadonlyMap<string, ClientSkin>>>): Promise<void> {
    const declared = source.clientScripts, data = source.runtime === null && !hasDeclaredClientPage(source);
    // the creatures this page draws: the script-bound ones, and in a data cell every spawn (its runtime draws a native cell's)
    const drawn = [...new Set([...declared.bindings.flatMap((binding) => binding.target.kind === 'creature' ? [binding.target.id] : []),
      ...(data ? source.creatures.spawns.map((row) => row.id) : [])])];
    if ((declared.bindings.length === 0 && drawn.length === 0) || this.cells.has(cell.instance)) return;
    const scope = this.ports.scope;
    let loading = skinsBySlug.get(cell.slug);
    if (loading === undefined) { loading = loadClientSkins(source, assets, compile, scope); skinsBySlug.set(cell.slug, loading); }
    const skins = await loading;
    if (scope.disposed) return;
    const creatures = new Map<string, CreatureView>();
    for (const id of drawn) {
      const spawn = source.creatures.spawns.find((row) => row.id === id);
      const species = spawn === undefined ? undefined : source.rows.species.find((row) => row.id === spawn.species);
      const look = species === undefined ? undefined : source.rows.looks.find((row) => row.species === species.id);
      const skin = look === undefined ? undefined : skins.get(look.id);
      if (spawn === undefined || species === undefined || skin === undefined) continue; // a non-skin look has no neighbour view yet
      const selected = clientVariantSkin(skin, spawn.variant);
      const { mesh, bones } = skinMesh(selected), driver = new SkinDriver(selected, bones, species.body?.skeleton);
      const scale = creatureScale(species.body, spawn.scale);
      // a hand-made row (a test's) may carry no variants or head size: the bar then reads the row's own hp as its full
      const variants: readonly { id: string; label: string; hp: number }[] = Array.isArray(species.variants) ? species.variants : [];
      const variant = variants.find((row) => row.id === spawn.variant) ?? variants[0], head = species.dims.headRadius;
      const target = new CreatureTarget(species.kind, variant?.label ?? species.label, Math.max(1, variant?.hp ?? 1), scale, species.dims.bodyY * 2 + (Number.isFinite(head) ? head : 0.3),
        { bodyY: species.dims.bodyY, bodyRadius: species.dims.bodyRadius }, species.lockable);
      if (species.body !== undefined && (species.body.skeleton !== undefined || species.body.lock !== undefined)) {
        const joints = selected.bones.map(def => {
          const parent = def.parent === null ? -1 : selected.bones.findIndex(row => row.name === def.parent), previous = selected.bones[parent];
          return { name: def.name, parent, position: [def.pos[0] - (previous?.pos[0] ?? 0), def.pos[1] - (previous?.pos[1] ?? 0), def.pos[2] - (previous?.pos[2] ?? 0)] as const };
        });
        const body = species.body, points = new CreatureSockets(body, joints, { position: mesh.position,
          get yaw() { return mesh.rotation.y; }, get scale() { return mesh.scale.x; } });
        target.lockPoints = { names: points.names, point: (index, out) => { root.updateWorldMatrix(true, false); return points.point(index, out).applyMatrix4(root.matrixWorld); } };
      }
      // CC27: a serpent's trail bones lie on the path its root drew, the same ring the server's volumes ride
      const trailRoot = { position: new Vector3(spawn.at[0], spawn.at[1], spawn.at[2]), yaw: spawn.yaw, scale };
      const trail = species.body?.skeleton === 'serpent' ? (() => { const volumes = new TrailCreatureVolumes(species.body, trailRoot, () => -Infinity); return { volumes, root: trailRoot, last: -1, death: new SerpentDeath(volumes.bones) }; })() : undefined;
      const view: CreatureView = { id, mesh, bones, driver, spawn: { at: spawn.at, yaw: spawn.yaw, scale }, bodyY: species.dims.bodyY * scale, target, t: (spawn.seed % 97) / 13, phase: 0, ...(trail === undefined ? {} : { trail }) };
      mesh.position.set(spawn.at[0], spawn.at[1], spawn.at[2]); mesh.rotation.set(0, spawn.yaw, 0, 'YXZ'); mesh.scale.setScalar(scale);
      // ZE3a: hidden from birth unless its cell is the active one: an admission that resolves between the late phase (which
      // hides a frozen cell's creatures) and the draw drew them once, and that draw linked their programs on the frame (a
      // neighbour's barrow warden, 114 ms, on the laptop's whole-road drive past an open plot, 2026-11-15)
      mesh.visible = this.ports.active(cell.instance);
      root.add(mesh); creatures.set(id, view);
    }
    const instance = cell.instance;
    const life: CellLife = { cell, root, creatures, lane: null, failed: null };
    if (declared.bindings.length > 0) {
      try { life.lane = this.lane(instance, source, assets, root, creatures); } catch (error) { life.failed = error instanceof Error ? error.message : String(error); }
    }
    this.cells.set(instance, life);
    scope.onDispose(() => {
      life.lane?.scripts.dispose();
      for (const view of creatures.values()) { view.mesh.removeFromParent(); view.mesh.skeleton.dispose(); const m = view.mesh.material; if (!Array.isArray(m)) m.dispose(); }
    });
  }

  /** The cell's own client lane and the views its frames compose on (throws when its scripts are refused). */
  private lane(instance: string, source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, root: Group, creatures: ReadonlyMap<string, CreatureView>): NonNullable<CellLife['lane']> {
    const declared = source.clientScripts;
    const observe = (target: ClientScriptTarget): { position: readonly [number, number, number]; frozen: boolean } => {
      const frozen = !this.ports.active(instance);
      if (target.kind === 'particles') return { position: target.at, frozen };
      const view = target.kind === 'creature' ? creatures.get(target.id) : undefined;
      if (view === undefined) return { position: [0, 0, 0], frozen };
      const p = view.mesh.position; return { position: [p.x, p.y, p.z], frozen };
    };
    // the page's view of the cell's public shared state: the wire's row, else the declared default until one arrives (a
    // player-scope or private field has no grid-page reader and reads its default; a string default reads as missing)
    const viewField = (_actor: string, scope: 'shared' | 'player', name: string): number | undefined => {
      const row = source.state[scope].find((field) => field.name === name);
      if (row === undefined || row.privacy === 'host' || (scope === 'shared' && row.privacy !== 'public')) return undefined;
      const value = scope === 'shared' ? this.ports.field?.(instance, name) : undefined;
      if (value !== undefined || typeof row.default === 'string') return value;
      return typeof row.default === 'boolean' ? Number(row.default) : row.default;
    };
    const scripts = createShardfileClientScripts(source, assets, { actorId: 'actor.neighbour', observe, state: { viewField } });
    try {
      const targets = scripts.targets.map(({ entity, target }): ClientScriptViewTarget => {
        const view = target.kind === 'creature' ? creatures.get(target.id) : undefined;
        const emitters = declared.bindings.find((b) => b.entity === entity)?.emitters.map((e) => ({ id: e.id, live: e.live, colour: e.colour, size: e.size, velocity: e.velocity, gravity: e.gravity })) ?? [];
        const anchor = (out: Vector3): Vector3 => {
          if (target.kind === 'particles') return out.fromArray(target.at);
          if (view === undefined) return out.set(0, 0, 0);
          return out.copy(view.mesh.position).setY(view.mesh.position.y + view.bodyY * 1.6);
        };
        const object: Object3D | null = view?.mesh ?? null;
        return { entity, object, anchor, emitters };
      });
      const views = new ClientScriptViews(scripts.lane, targets, { root, scope: this.ports.scope });
      // ZE3a: its particles too, hidden from birth unless its cell is active (a retired test shard's pool linked its program for 65 ms
      // on the road, 2026-11-15)
      views.show(this.ports.active(instance));
      return { scripts, views };
    } catch (error) { scripts.dispose(); throw error; }
  }

  /** The page's fixed step: the entered cell's lane advances on the page tick. */
  fixed(): void {
    const tick = this.tick++;
    for (const life of this.cells.values()) {
      const { lane } = life;
      if (lane === null || life.failed !== null || !this.ports.active(life.cell.instance)) continue; // G663: no neighbour logic
      try { lane.scripts.step(tick); } catch (error) { life.failed = error instanceof Error ? error.message : String(error); lane.views.restore(); }
    }
  }

  /** The page's late phase: views back to base, follow the region (if admitted), then compose the scripts on top. */
  late(dt: number): void {
    for (const life of this.cells.values()) {
      life.lane?.views.restore();
      const region = this.ports.simulation(life.cell.instance), live = this.ports.active(life.cell.instance);
      // G663: a frozen cell draws none of its creatures and composes no lane
      life.lane?.views.show(live);
      if (!live) { for (const view of life.creatures.values()) { view.mesh.visible = false; view.target.hidden = true; } continue; }
      for (const view of life.creatures.values()) {
        const sim = region?.host.entities.get(view.id);
        view.mesh.visible = true;
        if (sim !== undefined) { view.mesh.position.copy(sim.position); view.mesh.rotation.set(0, sim.yaw, 0, 'YXZ'); view.mesh.scale.setScalar(sim.scale); }
        view.t += dt; const speed = sim?.speed ?? 0, strafe = sim?.strafe ?? 0;
        view.phase = (view.phase + dt * Math.hypot(speed, strafe) * 0.6) % 1;
        this.follow(view, sim);
        const pose = sim?.hitVolumes;
        if (pose?.joint !== undefined) {
          for (const [name, bone] of Object.entries(view.bones)) if (!pose.joint(name, bone.position, bone.quaternion, bone.scale)) throw new Error(`Missing authoritative neighbour joint ${name}`);
        } else {
          view.driver.step({ dt, t: view.t, alive: sim?.alive ?? true, flinch: sim?.flinch ?? 0, attack: sim?.attackPhase ?? -1, speed, strafe, scale: sim?.scale ?? view.spawn.scale, phase: view.phase, state: sim?.state ?? 'idle' });
          creatureGunfire(view.driver, view.bones); // QA 11-19 row 42: a bandit's round leaves its muzzle
        }
        if (view.trail !== undefined && pose?.joint === undefined) {
          poseTrail(view, view.trail, sim);
          // QA 11-19 row 44: a serpent's death plays over the trail it lies on
          view.trail.death.step(sim?.alive ?? true, dt, view.bones, view.mesh.position.y, view.mesh.scale.x);
        }
      }
      if (life.failed === null) life.lane?.views.apply(dt);
    }
  }

  /** TC-B10: the bar's read of one creature: where it stands in the world, its hp, and a blow when the row's hp falls. */
  private follow(view: CreatureView, sim: NeighbourCreature | undefined): void {
    const target = view.target;
    view.mesh.updateWorldMatrix(true, false); target.position.setFromMatrixPosition(view.mesh.matrixWorld);
    target.hidden = false; target.alive = sim?.alive ?? true; target.scale = sim?.scale ?? view.spawn.scale;
    if (sim?.hp === undefined) return;
    if (sim.hp > target.maxHp) target.maxHp = sim.hp;
    if (target.lastHp !== null && sim.hp < target.lastHp) { reportCombatHit(target, target.lastHp - sim.hp, !target.alive || sim.hp <= 0); }
    target.lastHp = sim.hp; target.hp = sim.hp;
  }

  state(): readonly NeighbourLifeCell[] {
    return [...this.cells.values()].map((life) => ({ instance: life.cell.instance, creatures: life.creatures.size, frozen: !this.ports.active(life.cell.instance), views: life.lane?.views.state() ?? { targets: 0, posed: 0, particles: 0, capacity: 0, tick: 0 }, failed: life.failed }));
  }
}

/**
 * CC27: feed a serpent view's ring with the row's root on every sample tick (multiples of `TRAIL_SAMPLE_TICKS`) up to the
 * tick it is drawn at, then lay its trail bones from the drawn root. Two pages that heard the same rows hold the same ring,
 * so their bodies behind the head lie on one path; the head leads by whatever the two pages' draw ticks differ by.
 */
function poseTrail(view: CreatureView, trail: ViewTrail, sim: NeighbourCreature | undefined): void {
  const { root, volumes } = trail, now = sim?.tick === undefined ? undefined : Math.floor(sim.tick);
  if (sim !== undefined && now !== undefined && sim.rootAt !== undefined) {
    if (trail.last < 0 || now < trail.last || now - trail.last > TRAIL_CATCH_UP) {
      root.position.copy(sim.position); root.yaw = sim.yaw; root.scale = sim.scale; volumes.reseed();
    } else {
      for (let tick = (Math.floor(trail.last / TRAIL_SAMPLE_TICKS) + 1) * TRAIL_SAMPLE_TICKS; tick <= now; tick += TRAIL_SAMPLE_TICKS) {
        const at = sim.rootAt(tick);
        if (at !== null) { root.position.set(at.x, at.y, at.z); volumes.sample(tick); }
      }
    }
    trail.last = now;
  }
  root.position.copy(view.mesh.position); root.yaw = view.mesh.rotation.y; root.scale = view.mesh.scale.x;
  for (const name of volumes.bones) {
    const bone = view.bones[name];
    if (bone !== undefined) volumes.joint(name, bone.position, bone.quaternion, bone.scale);
  }
}
