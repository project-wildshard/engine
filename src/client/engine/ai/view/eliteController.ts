import type { EliteFeatureRows } from '@wildshard/format/eliteFeature';
import { pinBrain } from '../../../../shared/engine/ai/pinning';
import type { Scope } from '../../../../shared/engine/app/scope';
import { terrainHeight } from '../../../../shared/engine/world/terrainHeight';
import { StalkerBrain, type PouncerSpec, type HowlerSpec, type PouncerLedge, type HowlerPack } from '../../../../shared/engine/ai/stalker';
import { DiverBrain, type WindDiverSpec } from '../../../../shared/engine/ai/diver';
import type { EliteBar } from '../../ui/EliteBar';
import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { RowBodiesView } from '../../entities/RowBodies';
import type { Animal } from '../../entities/AnimalView';
import type { Player } from '../../player/Player';
import { app } from '../../app/runtime';
import { resourceScope } from '../../../../shared/engine/app/resources';
import { GroundTell } from '../../fx/groundTell';
import { fxMaterial, FX } from '../../fx/groundFx';
import { setEliteBrain, setEliteAct, setEliteDamage } from '../../../../shared/engine/entities/eliteBrain';

type EliteDefinition = EliteFeatureRows['fights'][number]['def'];

/** Client-only data binding of approved stalker and wind-diver encounter policies.
 * Native species keep their existing AI cadence; effects leave as named values. */
export type NativeEliteRow = {
  readonly def: EliteDefinition; readonly kind: string; readonly variant: string; readonly yaw: number; readonly offset: readonly [number, number];
  readonly memory: Readonly<Record<string, number>>; readonly tell: readonly [number, number, number];
  readonly beam: readonly [number, number, number]; readonly messages: Readonly<Record<string, string>>;
  readonly voices: Readonly<Record<string, string>>;
  readonly pack?: { readonly offset: readonly [number, number]; readonly variants: readonly string[] };
} & ({ readonly pattern: 'pouncer'; readonly spec: PouncerSpec } | { readonly pattern: 'howler'; readonly spec: HowlerSpec }
  | { readonly pattern: 'wind'; readonly spec: WindDiverSpec });
export type NativeEliteEffect = { readonly kind: 'feed'; readonly id: string; readonly at: THREE.Vector3 }
  | { readonly kind: 'sound'; readonly id: string; readonly at: THREE.Vector3 }
  | { readonly kind: 'hit'; readonly animal: Animal; readonly amount: number }
  | { readonly kind: 'knock'; readonly x: number; readonly z: number }
  | { readonly kind: 'pack'; readonly x: number; readonly z: number; readonly variants: readonly string[] };
/** Existing entered services, separate from the row. No author factory or
 * lifecycle override is accepted. The owner may attach a real pack after spawn. */
export interface NativeEliteServices {
  readonly game: Game; readonly animals: RowBodiesView; readonly player: Player; readonly lifecycle: { readonly signature: (id: string) => void }; readonly bar: EliteBar;
  readonly ledges: readonly PouncerLedge[]; readonly rock: { readonly x: number; readonly z: number; readonly top: number };
}
export interface NativeEliteObservation {
  readonly playerCrouched: boolean; readonly playerFwdX: number; readonly playerFwdZ: number; readonly grassHeight: number;
  readonly wind: { readonly x: number; readonly z: number };
}
export class NativeEliteController {
  readonly def: EliteDefinition;
  animal: Animal | null = null;
  pack: (HowlerPack<Animal> & { readonly members: readonly Animal[] }) | null = null;
  private phase2 = false;
  private observations: NativeEliteObservation | null = null;
  private observed(): NativeEliteObservation {
    if (this.observations === null) throw new Error('Unobserved elite environment');
    return this.observations;
  }
  observe(row: NativeEliteObservation): void {
    if (this.scope.disposed || this.scope.disposing) return;
    if (typeof row.playerCrouched !== 'boolean' || ![row.playerFwdX, row.playerFwdZ, row.grassHeight, row.wind.x, row.wind.z].every(Number.isFinite)) throw new Error('Invalid elite observations');
    this.observations = { ...row, wind: { ...row.wind } };
    if (this.animal !== null && this.bindings.length === 0) this.bindPolicy(this.animal);
  }
  private readonly policy: StalkerBrain<Animal> | DiverBrain<Animal>;
  private readonly events: NativeEliteEffect[] = [];
  private engagement: Scope | null = null;
  private readonly scope = resourceScope();
  private readonly bindings: (() => void)[] = [];
  private requireLive(): void { if (this.scope.disposed || this.scope.disposing) throw new Error('Retired elite controller owner'); }
  private releaseBindings(): void { for (const release of this.bindings.splice(0)) release(); }
  readonly row: NativeEliteRow;
  /** Its ground ring. A page on a server has it painted by what the server's kernel says. */
  readonly tell: GroundTell;
  private readonly services: NativeEliteServices;
  private readonly drop: THREE.Object3D;
  /** Its beam and chevron. A page on a server draws them from what the server's law says. */
  readonly aim: { readonly show: (from: THREE.Vector3, to: THREE.Vector3, alpha: number, time: number) => void; readonly hide: () => void };
  constructor(row: NativeEliteRow, services: NativeEliteServices, drop: THREE.Object3D) {
    this.requireLive();
    this.scope.onDispose(() => { this.releaseBindings(); });
    this.row = row; this.services = services; this.drop = drop;
    this.def = row.def;
    const { game, player, lifecycle, bar } = services;
    const tell = this.tell = new GroundTell(game.scene, 'ring', new THREE.Color(...row.tell));
    this.requireLive();
    const geometry = new THREE.CylinderGeometry(.05, .05, 1, 6, 1, true); geometry.translate(0, .5, 0);
    const material = fxMaterial(FX.beam, new THREE.Color(...row.beam), 0), beam = new THREE.Mesh(geometry, material);
    if (row.pattern === 'wind') { const scope = resourceScope(); scope.own(geometry); scope.own(material); scope.onDispose(() => { beam.removeFromParent(); }); material.depthTest = false; beam.visible = false; beam.frustumCulled = false; beam.renderOrder = 31; game.scene.add(beam); }
    else { geometry.dispose(); material.dispose(); }
    const up = new THREE.Vector3(0, 1, 0), delta = new THREE.Vector3(), head = new THREE.Vector3();
    const aim = { setTime: (time: number): void => { material.uniforms.uTime.value = time; }, aim: (from: THREE.Vector3, to: THREE.Vector3, alpha: number): void => {
      delta.subVectors(to, from); beam.position.copy(from); beam.scale.set(1, delta.length(), 1);
      beam.quaternion.setFromUnitVectors(up, delta.normalize()); material.uniforms.uAlpha.value = alpha; beam.visible = true;
    }, chevron: (point: THREE.Vector3 | null): void => { bar.chevron(point, game.camera); }, hide: (): void => { beam.visible = false; } };
    this.aim = { show: (from, to, alpha, time) => { aim.setTime(time); aim.aim(from, to, alpha); aim.chevron(from); }, hide: () => { aim.hide(); aim.chevron(null); } };
    const event = (kind: 'feed' | 'sound', name: string, at = player.position): void => {
      const id = (kind === 'feed' ? row.messages : row.voices)[name]; if (id !== undefined) this.events.push({ kind, id, at: at.clone() });
    };
    this.requireLive();
    const common = { player, lair: row.def.lair, phase2: () => this.phase2, signature: () => { lifecycle.signature(row.def.id); } };
    const contact = { hurt: (animal: Animal, amount: number): void => { this.events.push({ kind: 'hit', animal, amount }); },
      knock: (x: number, z: number): void => { this.events.push({ kind: 'knock', x, z }); },
      isHead: (animal: Animal, point: THREE.Vector3): boolean => animal.headWorld(head).distanceTo(point) < animal.dims.headRadius * animal.scale + .12 };
    if (row.pattern === 'pouncer') this.policy = new StalkerBrain({ pattern: 'pouncer', spec: row.spec, ports: {
      ...common, ...contact, awareRadius: row.def.awareR, ledges: services.ledges, heightAt: terrainHeight, ring: tell,
      opened: () => { event('feed', 'opened'); }, growl: at => { event('sound', 'growl', at); } } });
    else if (row.pattern === 'howler') this.policy = new StalkerBrain({ pattern: 'howler', spec: row.spec, ports: {
      ...common, ...contact, pack: () => this.pack, environment: () => { const sample = this.observed(); return { ...sample, grassHeightAt: () => sample.grassHeight }; }, random: () => app.rng.stream('ai').next(), rings: tell,
      regrouped: () => { event('feed', 'regrouped'); }, interrupted: () => { event('feed', 'interrupted'); }, closed: () => { event('feed', 'closed'); }, howl: at => { event('sound', 'howl', at); } } });
    else this.policy = new DiverBrain(null, { pattern: 'wind', spec: row.spec, ports: {
      ...common, ...contact, rock: services.rock, heightAt: terrainHeight, wind: () => this.observed().wind, random: () => app.rng.stream('ai').next(),
      tell: aim,
      grounded: () => { event('feed', 'grounded'); }, cry: at => { event('sound', 'cry', at); } } });
  }
  spawn(): void {
    this.requireLive();
    this.releaseBindings();
    const { row, policy, services } = this, a = services.animals.spawn(row.kind, this.def.lair.x + row.offset[0], this.def.lair.z + row.offset[1], row.yaw, row.variant);
    this.animal = a; a.herd = -1; Object.assign(a.mem, row.memory);
    if (row.pack !== undefined) this.events.push({ kind: 'pack', x: row.def.lair.x + row.pack.offset[0], z: row.def.lair.z + row.pack.offset[1], variants: row.pack.variants });
    if (policy instanceof StalkerBrain) policy.spawned(a); else policy.spawnWind(a);
    if (this.observations !== null) this.bindPolicy(a);
  }
  private bindPolicy(a: Animal): void {
    const { policy, row } = this;
    if (policy instanceof StalkerBrain) {
      this.bindings.push(setEliteBrain(a, (body, context) => { if (row.pattern === 'pouncer') policy.decidePouncer(body, context); else policy.decideHowler(body, context); }, this.scope));
      this.bindings.push(setEliteAct(a, body => { policy.act(body); }, this.scope), setEliteDamage(a, (body, point) => policy.damage(body, point), this.scope));
    } else this.bindings.push(setEliteBrain(a, (body, context) => { policy.decideWind(body, context); }, this.scope), setEliteDamage(a, (body, point) => policy.windDamage(body, point), this.scope));
  }
  despawn(): void {
    this.releaseBindings();
    this.events.length = 0;
    this.engagement?.dispose(); this.engagement = null;
    if (this.policy instanceof StalkerBrain) this.policy.disposeTell(); else this.policy.disposeWindTell();
    if (this.animal !== null) this.services.animals.retire(this.animal); this.animal = null;
    if (this.pack !== null) for (const member of this.pack.members) if (member.alive) this.services.animals.retire(member); this.pack = null;
  }
  reset(): void { if (this.scope.disposed || this.scope.disposing) return; this.phase2 = false; if (this.policy instanceof StalkerBrain) this.policy.reset(this.animal); else this.policy.resetWind(); }
  enterPhase2(): void { if (this.scope.disposed || this.scope.disposing) return; this.phase2 = true; if (this.policy instanceof StalkerBrain && this.row.pattern === 'howler') this.policy.enterPhase2(this.animal); }
  trophy(): void { /* Rewards are owned by the encounter host. */ }
  dropModel(): THREE.Object3D { this.requireLive(); return this.drop.clone(true); }
  tick(dt: number, time: number, engaged: boolean, leashing: boolean): void {
    if (this.scope.disposed || this.scope.disposing || this.observations === null) return;
    if (engaged && this.animal !== null && this.engagement === null) { this.engagement = this.services.game.levelScope.child(`elite.${this.def.id}`); pinBrain(this.animal, this.engagement); }
    else if (!engaged) { this.engagement?.dispose(); this.engagement = null; }
    if (this.policy instanceof StalkerBrain) this.policy.advance(this.animal, dt, time, engaged, leashing); else this.policy.advanceWind(this.animal, dt, time, engaged, leashing);
  }
  drainEffects(): NativeEliteEffect[] { if (this.scope.disposed || this.scope.disposing) this.events.length = 0; return this.events.splice(0); }
}
