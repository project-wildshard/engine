import * as THREE from 'three';
import { TamingSession, type TamingFrame, type TamingEffect, type TamingCandidate } from './tamingLegacyState';
import type { TamingHorse, TamingHerd, TamingObservation, TamingServices } from '../../src/shared/game/riding/bindingTypes';

/** Internal native effects around the shared data-only taming session. */
export class TamingBinding<A extends TamingHorse, H extends TamingHerd<A>> {
  private readonly session: TamingSession;
  private readonly invalidActor = new Error('Missing taming actor');
  private readonly candidates: TamingCandidate[] = Array.from({ length: 8 }, () => ({ id: '', x: 0, y: 0, z: 0, alive: 0, upgraded: 0, scale: 1, dot: 0 }));
  private readonly herdRows: TamingFrame['herds'][number][] = Array.from({ length: 8 }, () => ({ cx: 0, cz: 0, trust: 0, alert: 0, beaten: false, fleeing: false, stallion: null }));
  private readonly random: [number, number, number] = [0, 0, 0];
  private readonly frameData: TamingFrame = { x: 0, y: 0, z: 0, mounted: null, crouched: false, offer: false, lean: 0, wind: { x: 0, z: 0, strength: 0 }, random: this.random, herds: this.herdRows };
  private readonly allHerdRows = [...this.herdRows];
  private readonly actors = new Map<string, A>();
  private readonly ear = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly toward = new THREE.Vector3();
  readonly interactable = { position: new THREE.Vector3(0, -1e4, 0), radius: 0, label: '', onInteract: (): void => { this.startBreaking(); } };
  readonly view: TamingObservation = { trust: null, alert: 0, ear: null, round: null, balance: 0, danger: false, offer: false };
  onBonded?: ((horse: A) => void) | undefined;
  onBreaking?: ((on: boolean) => void) | undefined;
  input: { readonly held: (action: 'ride.offer' | 'lean.right' | 'lean.left') => boolean } | null = null;
  get phase(): 'wild' | 'breaking' | 'bonded' { return this.session.phase; }
  get companion(): A | null { return this.session.bonded === null ? null : this.actors.get(this.session.bonded) ?? null; }
  get upgraded(): boolean { return this.session.upgraded; }
  get promptHorse(): A | null { return this.session.stallion === null ? null : this.actors.get(this.session.stallion) ?? null; }
  constructor(private readonly opts: TamingServices<A, H>) {
    this.session = new TamingSession(opts.programs, opts.profile.fields);
    let saved: string | null = null; try { saved = opts.bond.read(); } catch { /* unavailable storage */ }
    if (saved === opts.profile.bonds[0] || saved === opts.profile.bonds[1]) this.spawn(opts.rest.x + opts.profile.offset[0], opts.rest.z + opts.profile.offset[1], Math.atan2(opts.rest.face.x, opts.rest.face.z), saved === opts.profile.bonds[1]);
  }
  private frame(draw = false): TamingFrame {
    const p = this.opts.player, herds = this.opts.herds(), frame = this.frameData;
    if (herds.length > 8) throw this.invalidActor;
    this.herdRows.length = herds.length;
    for (let i = 0; i < 8; i++) {
      const h = herds[i]; if (h === undefined) break;
      const row = this.allHerdRows[i], candidate = this.candidates[i]; if (row === undefined || candidate === undefined) throw this.invalidActor;
      this.herdRows[i] = row;
      const a = h.stallion;
      row.cx = h.cx; row.cz = h.cz; row.trust = h.trust; row.alert = h.alert; row.beaten = h.stallionState === 'beaten'; row.fleeing = h.mode === 'flee'; row.stallion = a === null ? null : candidate;
      if (a === null) continue;
      this.actors.set(a.entityId, a); a.headWorld(this.ear); p.camera.getWorldDirection(this.direction); this.toward.copy(this.ear).sub(p.camera.position).normalize();
      candidate.id = a.entityId; candidate.x = a.position.x; candidate.y = a.position.y; candidate.z = a.position.z;
      candidate.alive = Number(a.alive); candidate.upgraded = Number(a.kind === this.opts.profile.upgradeKind); candidate.scale = a.scale; candidate.dot = this.direction.dot(this.toward);
    }
    frame.x = p.position.x; frame.y = p.position.y; frame.z = p.position.z; frame.mounted = this.opts.mount.horse?.entityId ?? null; frame.crouched = p.crouching; frame.wind = this.opts.wind();
    frame.offer = this.input?.held('ride.offer') ?? this.opts.hud.offer;
    frame.lean = this.input ? Number(this.input.held('lean.right')) - Number(this.input.held('lean.left')) : Number(p.keys.has('KeyD')) - Number(p.keys.has('KeyA')) + this.opts.hud.lean;
    for (let i = 0; i < 3; i++) this.random[i] = draw ? this.opts.random() : 0;
    return frame;
  }
  private apply(effects: readonly TamingEffect[]): void {
    const herds = this.opts.herds(), m = this.opts.mount;
    for (let i = 0; i < 64; i++) {
      const effect = effects[i]; if (effect === undefined) break;
      if (effect.kind === 'trust') { const h = herds[effect.herd]; if (h !== undefined) { h.addTrust(effect.delta); if (effect.alert !== undefined) h.alert = effect.alert; } }
      else if (effect.kind === 'ownership') { const h = herds[effect.herd]; if (h !== undefined) h.alertOwned = effect.active; }
      else if (effect.kind === 'lead') herds[effect.herd]?.leadAway(effect.x, effect.z);
      else if (effect.kind === 'breaking') { m.breakRoll = 0; m.breakShake = 0; this.onBreaking?.(effect.on); }
      else if (effect.kind === 'dismount') m.dismount(effect.thrown);
      else if (effect.kind === 'hurt') this.opts.hurt(effect.damage);
      else if (effect.kind === 'notice') this.opts.toast?.(this.opts.profile.labels[effect.name]);
      else if (effect.kind === 'pose') {
        const a = this.actors.get(effect.actor); if (a === undefined) throw this.invalidActor;
        const row = effect.values; a.mem['buck'] = row['buck'] ?? 0; a.mem['buckDir'] = effect.direction;
        if ((row['rear'] ?? -1) >= 0) a.mem['rear'] = row['rear'] ?? 0;
        if (row['kick'] === 1) a.mem['kick'] = 1; if (row['toss'] === 1) a.mem['toss'] = 1;
        const yaw = row['yaw'] ?? 0; if (yaw !== 0) { a.setMotion(a.yaw + Math.sign(yaw) * 2, 0, 3.2); a.yaw += yaw; }
      } else {
        const a = this.actors.get(effect.actor), h = herds[effect.herd]; if (a === undefined || h === undefined) throw this.invalidActor;
        const { x, z } = a.position, yaw = a.yaw; m.dismount(); h.releaseStallion(); this.opts.hideStallion(a);
        const old = effect.previous === null ? null : this.actors.get(effect.previous); if (old !== null && old !== undefined) { m.removeMountable(old); this.opts.retireBonded(old); this.actors.delete(old.entityId); }
        const t = this.spawn(x, z, yaw, effect.upgraded); m.mount(t); this.opts.bond.write(this.opts.profile.bonds[Number(effect.upgraded)] ?? this.opts.profile.bonds[0]);
        this.opts.toast?.(this.opts.profile.labels.bonded[Number(effect.upgraded)] ?? this.opts.profile.labels.bonded[0]); this.onBonded?.(t);
      }
    }
    const state = this.session.view, a = this.promptHorse;
    this.interactable.radius = state.radius; this.interactable.label = state.beaten ? this.opts.profile.labels.breaking : this.opts.profile.labels.mount;
    if (a !== null) this.interactable.position.copy(a.position);
    if (state.ear && a !== null) { a.headWorld(this.ear); this.ear.y += state.earOffset; }
    this.view.trust = state.trust; this.view.alert = state.alert; this.view.round = state.round; this.view.balance = state.balance; this.view.danger = state.danger; this.view.offer = state.offer; this.view.ear = state.ear ? this.ear : null;
    m.breakRoll = state.roll; m.breakShake = state.shake;
  }
  noteEvent(name: string, x: number, z: number): void { if (name === 'pack-driven-off' || name === 'pack-break') this.apply(this.session.event(x, z, false, this.frame())); }
  noteShot(x: number, z: number): void { this.apply(this.session.event(x, z, true, this.frame())); }
  update(dt: number): void { this.apply(this.session.sample(dt, this.frame(this.phase === 'breaking' && this.session.sampleDue(dt)))); }
  canTame(a: A): boolean { return this.session.eligible(a.kind === this.opts.profile.upgradeKind); }
  startBreaking(): void {
    const a = this.promptHorse; if (a === null || this.phase === 'breaking' || !this.canTame(a) || !this.opts.mount.mount(a, true)) return;
    this.opts.player.yaw = a.yaw - Math.PI; this.opts.player.pitch = -.1; this.apply(this.session.start(this.frame(true)));
  }
  private spawn(x: number, z: number, yaw: number, upgraded: boolean): A {
    const a = this.opts.spawnBonded(x, z, yaw, upgraded); this.opts.mount.addMountable(a, this.opts.profile.names[Number(upgraded)] ?? this.opts.profile.names[0]); this.actors.set(a.entityId, a); this.session.adopt(a.entityId, upgraded); return a;
  }
  snapshot(): string { return this.session.snapshot(); }
  restore(wire: string, horses: readonly A[]): void {
    this.session.restore(wire, horses.map(a => a.entityId), this.opts.herds().length, this.opts.mount.horse?.entityId ?? null); this.actors.clear(); horses.forEach(a => { this.actors.set(a.entityId, a); }); this.apply([]);
  }
  forceBreak(): void { const h = this.session.herd === null ? null : this.opts.herds()[this.session.herd]; if (h === null || h === undefined || this.promptHorse === null) return; h.addTrust(100); this.startBreaking(); }
}
