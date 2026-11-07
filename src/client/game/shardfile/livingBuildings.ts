import * as v from 'valibot';
import { Color, MeshBasicMaterial, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import { SiteLights, type LightSite } from '@wildshard/engine/fx/SiteLights';
import type { DoorMotionEvents } from '@wildshard/engine/audio/declaredGameplay';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { ColliderDesc, WorldRegistry } from '@wildshard/engine/world/registry';
import { BuildingContinuationSchema, parseBuildingLifeLook, parseBuildingLifeRows, type BuildingContinuation, type BuildingLifeLook, type BuildingLifeRows } from '@wildshard/format/buildings';
import { setLentParam } from './lentLooks';
import type { SceneHandles } from './sceneHandles';
import type { SaveStore } from '@wildshard/engine/saves/store';
import type { Scope } from '@wildshard/engine/app/scope';
import { instanceSave } from '../../../shared/game/instanceSaves';
import { buildingDoor, buildingDoorCollides, buildingDoorSwinging, buildingDoorYaw, buildingSave, stepBuildingDoor, toggleBuildingDoor, type BuildingDoorState } from '../../../shared/game/shardfile/buildingDoor';

/** a door's state (buildingDoor.ts: the same owner the Node simulation drives) with its leaf, prompt and slab */
interface Door extends BuildingDoorState {
  readonly pivot: Object3D; readonly prompt: Interactable;
  readonly slab: ColliderDesc; readonly labels: readonly [string, string];
}

class BuildingDoorChanges extends EventTarget implements DoorMotionEvents {
  current: DoorMotionEvents['current'] = null;
  emit(position: Vector3, opening: boolean): void { this.current = { position, opening }; this.dispatchEvent(new Event('door')); }
}

/** Client-only building presentation over platform scene resources and JSON rows.
 * Prompts and kinematic leaves share one reversible door state. Static collision
 * remains on the scene assembler; registerDoors owns moving-leaf registration.
 * No shard callback, subclass or owner/path reflection enters this host. */
export class LivingBuildings {
  readonly interactables: Interactable[] = [];
  /** Output-only native notifications consumed by platform audio; no shard hooks. */
  readonly doorChanges: DoorMotionEvents = new BuildingDoorChanges();
  /** Existing audio may borrow this scalar; mutations never call back into a shard. */
  readonly audioState = { wheel: { value: 0 } };
  private readonly look: BuildingLifeLook;
  private readonly lights: SiteLights;
  private readonly doors: Door[] = [];
  private readonly swings: { readonly pivot: Object3D; readonly seed: number }[] = [];
  private readonly wheels: { readonly id: string; readonly object: Object3D }[] = [];
  private readonly colors: { readonly material: MeshBasicMaterial | MeshStandardMaterial; readonly base: Color; readonly row: BuildingLifeRows['colors'][number] }[] = [];
  private readonly params: BuildingLifeRows['params'] = [];
  private elapsed = 0;
  private dusk = 0;
  private readonly idleEye = new Vector3();
  private readonly lamps: { readonly material: MeshStandardMaterial; readonly full: number }[] = [];
  private readonly sites = new Map<string, LightSite & { state: { lit: boolean } }>();
  private readonly gain = { fire: 1, lamp: 1 };
  private checkpoint: (() => boolean) | null = null;
  private saveTime = 0;
  private registeredDoors = false;
  private served: ((id: string) => boolean) | null = null;
  private sharedCount = 0;
  private flickerCount = 0;

  constructor(private readonly resources: SceneHandles, input: BuildingLifeLook) {
    this.look = parseBuildingLifeLook(input);
    this.audioState.wheel.value = this.look.wheel;
    this.lights = new SiteLights(this.look);
  }
  get wheelSpeed(): number { return this.audioState.wheel.value; }
  set wheelSpeed(value: number) { if (!Number.isFinite(value)) throw new Error('Invalid wheel speed'); this.audioState.wheel.value = value; }

  /** Admit a whole batch before allocating prompts or mutating any owner. */
  add(input: BuildingLifeRows): void {
    const row = parseBuildingLifeRows(input);
    if (this.registeredDoors && row.doors.length > 0) throw new Error('Building doors already registered');
    if (this.sharedCount + row.shared.length > 8 || this.flickerCount + row.flickers.length > 128) throw new Error('Building light capacity');
    const ids = [...this.doors.map(door => door.id), ...row.doors.map(door => door.id)];
    if (ids.length > 128 || new Set(ids).size !== ids.length) throw new Error('Duplicate or excessive building doors');
    const siteIds = [...this.sites.keys(), ...row.sites.map(site => site.id)];
    if (siteIds.length > 128 || new Set(siteIds).size !== siteIds.length) throw new Error('Duplicate or excessive building sites');
    if (this.swings.length + row.swings.length > 128 || this.wheels.length + row.wheels.length > 128 || this.lamps.length + row.lamps.length > 128) throw new Error('Building life capacity');
    const doors = row.doors.map(door => ({ row: door, pivot: this.resources.object(door.pivot) }));
    const swings = row.swings.map(swing => ({ pivot: this.resources.object(swing.pivot), seed: swing.seed }));
    const wheels = row.wheels.map(wheel => ({ id: wheel.id, object: this.resources.object(wheel.object) }));
    if (new Set([...this.wheels.map(wheel => wheel.id), ...row.wheels.map(wheel => wheel.id)]).size !== this.wheels.length + row.wheels.length) throw new Error('Duplicate building wheel');
    const lamps = row.lamps.map(lamp => ({ material: this.resources.standard(lamp.material), full: lamp.full }));
    const flickers = row.flickers.map(light => ({ ...light, light: this.resources.light(light.light) }));
    if (this.colors.length + row.colors.length > 128 || this.params.length + row.params.length > 128) throw new Error('Building material capacity');
    const colors = row.colors.map(pulse => {
      const material = this.resources.material(pulse.material);
      if (!(material instanceof MeshBasicMaterial) && !(material instanceof MeshStandardMaterial)) throw new Error('Building pulse needs a color material');
      return { material, base: new Color(...pulse.color), row: pulse };
    });
    const shared = row.shared.map(id => this.resources.light(id));
    const sites = row.sites.map(site => ({ id: site.id, site: { state: { lit: true }, root: this.resources.object(site.root),
      anchors: site.anchors.map(anchor => ({ ...anchor, anchor: this.resources.object(anchor.anchor) })),
      ...(site.rooms === undefined ? {} : { rooms: site.rooms }), ...(site.door === undefined ? {} : { door: site.door }) } }));
    for (const { row: spec, pivot } of doors) {
      const door: Door = { ...buildingDoor(spec.id), pivot, slab: spec.slab, labels: [spec.open, spec.close],
        prompt: { position: new Vector3(...spec.at), radius: spec.reach, label: spec.open, onInteract: () => { this.use(spec.id); } } };
      this.doors.push(door); this.interactables.push(door.prompt);
    }
    this.colors.push(...colors); this.params.push(...row.params);
    this.swings.push(...swings); this.wheels.push(...wheels); this.lamps.push(...lamps);
    this.sharedCount += shared.length; this.flickerCount += flickers.length;
    for (const light of flickers) this.lights.addFlicker(light);
    for (const light of shared) { light.intensity = 0; this.lights.addLight(light); }
    for (const site of sites) { this.sites.set(site.id, site.site); this.lights.addSite(site.site); }
  }

  /** Register each native kinematic leaf once, under the current engine owner.
   * Moving leaves do not trap the player; rearm after the player clears the hinge. */
  registerDoors(registry: WorldRegistry, player: Vector3): void {
    const collision = this.look.door.collision;
    if (collision === undefined || this.registeredDoors) throw new Error('Building doors require one declared collision owner');
    this.registeredDoors = true;
    const at = new Vector3(), radius2 = collision.rearmRadius * collision.rearmRadius;
    for (const door of this.doors) registry.add({ id: door.id, name: collision.name, category: 'buildings', file: collision.file, surface: collision.surface,
      follows: door.pivot, colliders: [door.slab], active: () => buildingDoorCollides(door, () => door.pivot.getWorldPosition(at).distanceToSquared(player) > radius2) });
  }

  /** Platform output callbacks bind only this host's commands, never shard code. */
  doorPieces(): { id: string; pivot: Object3D; colliders: ColliderDesc[]; use: () => void; swinging: () => boolean }[] {
    return this.doors.map(door => ({ id: door.id, pivot: door.pivot, colliders: [door.slab], use: () => { this.use(door.id); }, swinging: () => buildingDoorSwinging(door) }));
  }
  /** On a server's word: a press asks it, and `open` says what stands. A door is the world's, so another player's hand moves it here too. */
  serve(open: (id: string) => boolean): void {
    this.served = open;
    for (const door of this.doors) door.prompt.wireId = door.id;
  }
  use(id: string): void {
    if (this.served === null) this.swing(id);
  }
  private swing(id: string): void {
    const door = this.doors.find(value => value.id === id);
    if (door === undefined) throw new Error(`Missing building door: ${id}`);
    door.prompt.label = toggleBuildingDoor(door) ? door.labels[1] : door.labels[0];
    const changes = this.doorChanges;
    if (changes instanceof BuildingDoorChanges) changes.emit(door.prompt.position, door.open);
    this.checkpoint?.();
  }
  /** Lone lamp ignition is an explicit command addressed by site id. */
  setLit(id: string, lit: boolean): void {
    const site = this.sites.get(id); if (site === undefined) throw new Error(`Missing building site: ${id}`);
    site.state.lit = lit;
  }
  private pose(door: Door): void { door.pivot.rotation.y = buildingDoorYaw(door.t, this.look.door.angle); }
  /** Same operation order as the native presentation: wheels, doors, lighting, glass, swings. */
  tick(dt: number, t: number, eye: Vector3, lamps: number): void {
    if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(t) || !Number.isFinite(lamps)) throw new Error('Invalid building clock');
    for (const wheel of this.wheels) wheel.object.rotation.x += dt * this.wheelSpeed;
    const { served } = this;
    if (served !== null) for (const door of this.doors) if (served(door.id) !== door.open) this.swing(door.id);
    for (const door of this.doors) if (stepBuildingDoor(door, dt, this.look.door.seconds)) this.pose(door);
    const look = this.look;
    this.gain.fire = look.fire[0] + look.fire[1] * lamps; this.gain.lamp = look.lamp[0] + look.lamp[1] * lamps;
    this.lights.step(t, eye, this.gain);
    for (const lamp of this.lamps) lamp.material.emissiveIntensity = lamp.full * (look.glass[0] + look.glass[1] * lamps);
    for (const entry of this.colors) {
      const row = entry.row;
      let pulse = row.pulse[1]; for (const wave of row.waves) pulse *= Math.sin(t * wave[0] + wave[1]);
      pulse = row.pulse[0] + pulse;
      entry.material.color.copy(entry.base).multiplyScalar(row.offset + row.gain * pulse * (row.night[0] + row.night[1] * lamps));
    }
    for (const swing of this.swings) {
      let z = 0;
      for (const wave of look.swing.z) z += Math.sin(t * wave[0] + swing.seed * wave[1]) * wave[2];
      swing.pivot.rotation.z = z; swing.pivot.rotation.x = Math.cos(t * look.swing.x[0] + swing.seed) * look.swing.x[1];
    }
    if (this.checkpoint !== null && (this.saveTime += dt) >= 5) { this.saveTime = 0; this.checkpoint(); }
  }
  /** Standalone site loops use their own accumulated presentation time. */
  update(dt: number): void { if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid building delta'); this.elapsed += dt; this.tick(dt, this.elapsed, this.idleEye, this.dusk); }
  /** The shared day clock publishes a scalar; graph parameters are declared rows. */
  setDusk(value: number): void {
    if (!Number.isFinite(value)) throw new Error('Invalid building dusk');
    this.dusk = Math.max(0, Math.min(1, value));
    for (const row of this.params) setLentParam(row.look, row.param, this.dusk);
  }
  /** Bind durable state only after all buildings have published their stable door/wheel ids.
   * The engine save slot fences stale writes after New Game; instance identity is data. */
  persist(store: SaveStore, scope: Scope, identity: { readonly id: string; readonly shard: string; readonly group: string }): void {
    if (scope.disposed || this.checkpoint !== null) throw new Error('Building persistence needs a fresh live owner');
    if (!/^[A-Za-z0-9._-]{1,128}$/u.test(identity.group)) throw new Error('Invalid building save group');
    const slot = instanceSave(store, buildingSave, identity), prior = slot.read()[identity.group];
    if (prior !== undefined) this.restore(prior);
    // A served page only draws what the server holds: its copy would shut the doors of the save a rollback reads.
    this.checkpoint = () => this.served !== null || slot.write({ ...slot.read(), [identity.group]: this.snapshot() });
    scope.onDispose(() => { this.checkpoint?.(); this.checkpoint = null; });
    if (typeof window !== 'undefined') scope.listen(window, 'pagehide', () => { this.checkpoint?.(); });
    if (typeof document !== 'undefined') scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') this.checkpoint?.(); });
  }
  snapshot(): BuildingContinuation {
    return { version: 1, speed: this.wheelSpeed, doors: this.doors.map(door => ({ id: door.id, open: door.open, enabled: door.enabled, t: door.t })),
      wheels: this.wheels.map(wheel => ({ id: wheel.id, angle: wheel.object.rotation.x })) };
  }
  /** Validate identities and all values before applying any part of a continuation. */
  restore(input: unknown): void {
    const saved = v.parse(BuildingContinuationSchema, input);
    const doors = new Map(saved.doors.map(door => [door.id, door])), wheels = new Map(saved.wheels.map(wheel => [wheel.id, wheel]));
    if (doors.size !== saved.doors.length || wheels.size !== saved.wheels.length || doors.size !== this.doors.length || wheels.size !== this.wheels.length
      || this.doors.some(door => !doors.has(door.id)) || this.wheels.some(wheel => !wheels.has(wheel.id))) throw new Error('Incompatible building continuation');
    this.wheelSpeed = saved.speed;
    for (const door of this.doors) {
      const state = doors.get(door.id); if (state === undefined) throw new Error('Missing saved door');
      door.open = state.open; door.enabled = state.enabled; door.t = state.t; door.prompt.label = door.open ? door.labels[1] : door.labels[0]; this.pose(door);
    }
    for (const wheel of this.wheels) { const state = wheels.get(wheel.id); if (state === undefined) throw new Error('Missing saved wheel'); wheel.object.rotation.x = state.angle; }
  }
}
