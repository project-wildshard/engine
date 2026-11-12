/**
 * A cell's client life (SHARD-PLATFORM SF25 render side): each shardfile cell that declares `clientScripts` gets its
 * creatures drawn in its cell root (the SF9c skins, following its regional host's authoritative entities) and its own
 * isolated client lane (`createShardfileClientScripts`, sp-x5) stepped on the page's fixed tick; `ClientScriptViews`
 * composes its frames on top of the views and draws its particles. Nothing here writes a simulation.
 *
 * Only while the traveller is inside the cell (G663, tile streaming T7: a neighbour is scene-graph level of detail, with
 * no logic or runtime; it replaced G66's "frozen, but alive-looking" neighbours): a frozen cell's lane never steps and its
 * creatures stay hidden, so a neighbour shows only its tiles.
 */
import { Bone, Skeleton, SkinnedMesh, type Group, type Object3D, type Vector3 } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { createShardfileClientScripts } from '../shardfile/clientScripts';
import type { ClientScriptTarget } from '@wildshard/format/clientScripts';
import { loadClientSkins, SkinDriver, type ClientSkin, type SkinDriveState } from '../shardfile/clientSkins';
import { ClientScriptViews, type ClientScriptViewTarget, type ClientScriptViewState } from "../plugin/ui";
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { GridCell } from '../../../shared/game/grid/assembly';

/** One creature as a view draws it (E6): a page reads the region's sim entity, a client reads its row. */
export interface NeighbourCreature {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number; readonly scale: number; readonly speed: number; readonly strafe: number;
  readonly alive: boolean; readonly attackPhase: number; readonly state: SkinDriveState['state'];
}
/** A cell's admitted region, as much of it as a view reads. */
export interface NeighbourRegion { readonly host: { readonly entities: { get: (id: string) => NeighbourCreature | undefined } } }
/** What a cell's life reads from the session: its admitted region (absent until the live host admits it) and whether it is the active frame. */
export interface NeighbourLifePorts {
  readonly scope: Scope;
  readonly simulation: (instance: string) => NeighbourRegion | undefined;
  readonly active: (instance: string) => boolean;
}
/** One cell's readout. */
export interface NeighbourLifeCell { readonly instance: string; readonly creatures: number; readonly frozen: boolean; readonly views: ClientScriptViewState; readonly failed: string | null }

interface CreatureView { readonly id: string; readonly mesh: SkinnedMesh; readonly driver: SkinDriver; readonly spawn: { at: readonly [number, number, number]; yaw: number; scale: number }; readonly bodyY: number; t: number; phase: number }
interface CellLife {
  readonly cell: GridCell; readonly root: Group; readonly creatures: ReadonlyMap<string, CreatureView>;
  readonly scripts: ReturnType<typeof createShardfileClientScripts>; readonly views: ClientScriptViews; failed: string | null;
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
  constructor(ports: NeighbourLifePorts) { this.ports = ports; }

  /** Admit one neighbour's life once its product and materials are ready (the session's shared per-slug load). */
  async admit(cell: GridCell, root: Group, source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, compile: Parameters<typeof loadClientSkins>[2], skinsBySlug: Map<string, Promise<ReadonlyMap<string, ClientSkin>>>): Promise<void> {
    const declared = source.clientScripts;
    if (declared.bindings.length === 0 || this.cells.has(cell.instance)) return;
    const scope = this.ports.scope;
    let loading = skinsBySlug.get(cell.slug);
    if (loading === undefined) { loading = loadClientSkins(source, assets, compile, scope); skinsBySlug.set(cell.slug, loading); }
    const skins = await loading;
    if (scope.disposed) return;
    const creatures = new Map<string, CreatureView>();
    for (const binding of declared.bindings) {
      if (binding.target.kind !== 'creature' || creatures.has(binding.target.id)) continue;
      const id = binding.target.id, spawn = source.creatures.spawns.find((row) => row.id === id);
      const species = spawn === undefined ? undefined : source.rows.species.find((row) => row.id === spawn.species);
      const look = species === undefined ? undefined : source.rows.looks.find((row) => row.species === species.id);
      const skin = look === undefined ? undefined : skins.get(look.id);
      if (spawn === undefined || species === undefined || skin === undefined) continue; // a non-skin look has no neighbour view yet
      const { mesh, bones } = skinMesh(skin), driver = new SkinDriver(skin, bones);
      const view: CreatureView = { id, mesh, driver, spawn: { at: spawn.at, yaw: spawn.yaw, scale: spawn.scale }, bodyY: species.dims.bodyY * spawn.scale, t: (spawn.seed % 97) / 13, phase: 0 };
      mesh.position.set(spawn.at[0], spawn.at[1], spawn.at[2]); mesh.rotation.set(0, spawn.yaw, 0, 'YXZ'); mesh.scale.setScalar(spawn.scale);
      root.add(mesh); creatures.set(id, view);
    }
    const instance = cell.instance;
    const observe = (target: ClientScriptTarget): { position: readonly [number, number, number]; frozen: boolean } => {
      const frozen = !this.ports.active(instance);
      if (target.kind === 'particles') return { position: target.at, frozen };
      const view = target.kind === 'creature' ? creatures.get(target.id) : undefined;
      if (view === undefined) return { position: [0, 0, 0], frozen };
      const p = view.mesh.position; return { position: [p.x, p.y, p.z], frozen };
    };
    const scripts = createShardfileClientScripts(source, assets, { actorId: 'actor.neighbour', observe });
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
    const views = new ClientScriptViews(scripts.lane, targets, { root, scope });
    const life: CellLife = { cell, root, creatures, scripts, views, failed: null };
    this.cells.set(instance, life);
    scope.onDispose(() => {
      scripts.dispose();
      for (const view of creatures.values()) { view.mesh.removeFromParent(); view.mesh.skeleton.dispose(); const m = view.mesh.material; if (!Array.isArray(m)) m.dispose(); }
    });
  }

  /** The page's fixed step: the entered cell's lane advances on the page tick. */
  fixed(): void {
    const tick = this.tick++;
    for (const life of this.cells.values()) {
      if (life.failed !== null || !this.ports.active(life.cell.instance)) continue; // G663: no neighbour logic
      try { life.scripts.step(tick); } catch (error) { life.failed = error instanceof Error ? error.message : String(error); life.views.restore(); }
    }
  }

  /** The page's late phase: views back to base, follow the region (if admitted), then compose the scripts on top. */
  late(dt: number): void {
    for (const life of this.cells.values()) {
      life.views.restore();
      const region = this.ports.simulation(life.cell.instance), live = this.ports.active(life.cell.instance);
      // G663: a frozen cell draws none of its creatures and composes no lane
      if (!live) { for (const view of life.creatures.values()) view.mesh.visible = false; continue; }
      for (const view of life.creatures.values()) {
        const sim = region?.host.entities.get(view.id);
        view.mesh.visible = true;
        if (sim !== undefined) { view.mesh.position.copy(sim.position); view.mesh.rotation.set(0, sim.yaw, 0, 'YXZ'); view.mesh.scale.setScalar(sim.scale); }
        view.t += dt; const speed = sim?.speed ?? 0, strafe = sim?.strafe ?? 0;
        view.phase = (view.phase + dt * Math.hypot(speed, strafe) * 0.6) % 1;
        view.driver.step({ dt, t: view.t, alive: sim?.alive ?? true, flinch: 0, attack: sim?.attackPhase ?? -1, speed, strafe, scale: sim?.scale ?? view.spawn.scale, phase: view.phase, state: sim?.state ?? 'idle' });
      }
      if (life.failed === null) life.views.apply(dt);
    }
  }

  state(): readonly NeighbourLifeCell[] {
    return [...this.cells.values()].map((life) => ({ instance: life.cell.instance, creatures: life.creatures.size, frozen: !this.ports.active(life.cell.instance), views: life.views.state(), failed: life.failed }));
  }
}
