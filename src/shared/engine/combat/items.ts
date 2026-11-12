import { Vector3 } from 'three';
import type { AimCommand } from '../input/commands';
import type { Actor, CombatPipeline, CombatTag, CombatTarget } from './pipeline';
import type { EffectId } from './effects/types';
import type { ScriptHost } from '../script/host';
import type { Scope } from '../app/scope';

/** Numeric action requests accepted from input and an admitted item hook. */
export type ItemAction = 1 | 2 | 3 | 4;
/** Trusted contact values; scripts select a row but never supply damage or an effect id. */
export interface ItemAttack { id: string; damage: number; cooldown: number; range: number; width: number; tags: readonly CombatTag[]; effect: EffectId | null }
/** Data used by an authoritative item; kit factories add equipment UI and a view. A null tool action leaves input with its trusted runtime. */
export type ItemSpec = { id: string; kind: 'weapon'; light: ItemAttack; heavy: ItemAttack; charge: number }
  | { id: string; kind: 'tool'; action: `${string}.${string}` | null; fuelSeconds: number; intensity: number };
/** Script hooks return only a bounded action selection. The host owns tick admission and aggregate allowances. */
export type ItemHook = (input: { tick: number; dt: number; action: ItemAction; fuel: number; cooldown: number }) => ItemAction | null;
/** Host-supplied body contact position, shared by headless targets and posed client rigs. */
export interface ItemTarget extends CombatTarget { readonly aimPoint: Vector3 }
/** Existing actor/contact/effect ports; no renderer or active app participates in item simulation. */
export interface ItemPorts {
  active?: () => boolean;
  actor: Actor; combat: Pick<CombatPipeline, 'hit'>; targets: () => readonly ItemTarget[];
  hook: ItemHook | null; effect: (target: Actor, effect: EffectId, source: Actor) => void;
  changed?: (item: ItemRuntime, phase: 'fire' | 'hit' | 'light') => void;
}
/** Validated contact presentation; the owning weapon forwards it through normal equipment events. */
export interface ItemContact { kind: string; headshot: boolean; killed: boolean }
/** Complete numeric continuation. Script memory belongs to the shared script host snapshot. */
export interface ItemState { version: number; id: string; tick: number; cooldown: number; fuel: number; lit: boolean; held: boolean; chargeTime: number; pending: { action: ItemAction; aim: AimCommand | null }[] }
const finiteAim = (aim: AimCommand): boolean => [aim.origin.x, aim.origin.y, aim.origin.z, aim.direction.x, aim.direction.y, aim.direction.z].every(Number.isFinite)
  && Math.hypot(aim.direction.x, aim.direction.y, aim.direction.z) > 1e-6;
/** Compile a hook over the already installed, shared ScriptHost. An author cannot target another item or invent an action. */
export function scriptItemHook(host: ScriptHost, module: string, entity: number, event: number, actorId: string, seat: number = entity): ItemHook {
  if (typeof actorId !== 'string' || actorId.length === 0 || actorId.length > 128
    || host.world.actor(seat) !== actorId) throw new Error('Item hook requires its host-bound owner');
  return (input) => {
    const call = host.call(module, seat, [input.tick, input.dt, input.action, entity, input.fuel, input.cooldown]);
    if (!call.ok || call.events.length !== 1) return null;
    const request = call.events[0];
    if (request === undefined || request.type !== event || request.target !== entity || request.value !== input.action) return null;
    return input.action;
  };
}
/** Fixed-step weapon/tool state. Input queues once; render updates only read it. */
export class ItemRuntime {
  readonly spec: ItemSpec;
  private readonly ports: ItemPorts;
  private tick = -1;
  private cooldown = 0;
  private fuel = 1;
  private lit = false;
  private held = false;
  private chargeTime = 0;
  private readonly observers = new Set<(phase: 'fire' | 'hit' | 'light', contact?: ItemContact, heavy?: boolean) => void>();
  private pending: ItemState['pending'] = [];
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly point = new Vector3();
  private readonly lateral = new Vector3();
  constructor(spec: ItemSpec, ports: ItemPorts) {
    const duration = (n: number): boolean => Number.isFinite(n) && n > 0 && n <= 86400;
    const valid = spec.kind === 'weapon' ? duration(spec.charge) && spec.charge <= 5 && [spec.light, spec.heavy].every((attack) =>
      Number.isFinite(attack.damage) && attack.damage >= 0 && attack.damage <= 10000 && duration(attack.cooldown)
      && Number.isFinite(attack.range) && attack.range > 0 && attack.range <= 20
      && Number.isFinite(attack.width) && attack.width > 0 && attack.width <= 20)
      : duration(spec.fuelSeconds) && Number.isFinite(spec.intensity) && spec.intensity >= 0 && spec.intensity <= 10;
    if (!valid) throw new RangeError('Invalid numeric item specification');
    this.spec = structuredClone(spec); this.ports = ports;
  }
  /** Scoped presentation/event observers; retiring a view leaves authoritative item state intact. */
  observe(scope: Scope, run: (phase: 'fire' | 'hit' | 'light', contact?: ItemContact, heavy?: boolean) => void): void {
    if (scope.disposed) return;
    this.observers.add(run); scope.onDispose(() => { this.observers.delete(run); });
  }
  /** `heavy`: on `fire`, whether the strike that started was the heavy one (a held view swings to match, TE-ENG4). */
  private notify(phase: 'fire' | 'hit' | 'light', contact?: ItemContact, heavy?: boolean): void {
    this.ports.changed?.(this, phase); for (const observer of this.observers) observer(phase, contact, heavy);
  }
  get remainingFuel(): number { return this.fuel; }
  get lightOn(): boolean { return this.lit; }
  get remainingCooldown(): number { return this.cooldown; }
  /** Copy command aim at the input boundary, bounded before any script or gameplay work. */
  queue(action: ItemAction, aim: AimCommand | null = null): void {
    if (![1, 2, 3, 4].includes(action) || this.pending.length >= 16 || (this.spec.kind === 'weapon' && (action >= 3 || aim === null))
      || (this.spec.kind === 'tool' && action < 3) || (aim !== null && !finiteAim(aim))) throw new RangeError('Invalid item command');
    this.pending.push({ action, aim: aim === null ? null : { origin: { ...aim.origin }, direction: { ...aim.direction } } });
  }
  /** Hold/release is command state; charge duration advances only on fixed ticks. */
  hold(on: boolean, aim: AimCommand, fireOnRelease = true): void {
    if (this.spec.kind !== 'weapon' || !finiteAim(aim)) throw new RangeError('Invalid item hold');
    if (this.held === on) return;
    if (!on && fireOnRelease && this.chargeTime >= this.spec.charge) this.queue(2, aim);
    this.held = on; if (!on) this.chargeTime = 0;
  }
  /** Run after the shared script host begins this fixed tick; fuel, contacts and cooldown use only dt. */
  step(tick: number, dt: number): void {
    if (!Number.isSafeInteger(tick) || tick <= this.tick || !Number.isFinite(dt) || dt <= 0 || dt > 1) throw new RangeError('Invalid item tick');
    this.tick = tick; if (this.held) this.chargeTime += dt; this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.spec.kind === 'tool' && this.lit) {
      this.fuel = Math.max(0, this.fuel - dt / this.spec.fuelSeconds);
      if (this.fuel === 0) { this.lit = false; this.notify('light'); }
    }
    // Fuel notifications may have queued a command: check only after those
    // callbacks, and still advance every clock above when nothing is pending.
    if (this.pending.length === 0) return;
    const pending = this.pending; this.pending = [];
    for (const command of pending) {
      if (this.ports.active?.() === false || !this.ports.actor.alive || (this.spec.kind === 'weapon' && this.cooldown > 0)) continue;
      const action = this.ports.hook === null ? command.action : this.ports.hook({ tick, dt, action: command.action, fuel: this.fuel, cooldown: this.cooldown });
      if (action !== command.action) continue;
      if (this.spec.kind === 'tool') {
        if (action === 4) { this.fuel = 1; this.notify('light'); }
        else if (this.fuel > 0) { this.lit = !this.lit; this.notify('light'); }
      } else if (command.aim !== null) this.strike(action === 2 ? this.spec.heavy : this.spec.light, command.aim);
    }
  }
  private strike(attack: ItemAttack, aim: AimCommand): void {
    this.cooldown = attack.cooldown; this.notify('fire', undefined, this.spec.kind === 'weapon' && attack === this.spec.heavy);
    this.origin.copy(aim.origin); this.direction.copy(aim.direction).normalize();
    const target = this.ports.targets().filter((entry) => {
      if (!entry.hittable || entry.actor === this.ports.actor) return false;
      this.point.copy(entry.aimPoint).sub(this.origin);
      const along = this.point.dot(this.direction), lateral = this.lateral.copy(this.point).addScaledVector(this.direction, -along).length();
      // Contact uses the creature's body position; aim rays can pass within an authored lane radius.
      return along >= 0 && along <= attack.range && lateral <= attack.width / 2;
    }).sort((a, b) => a.aimPoint.distanceToSquared(this.origin) - b.aimPoint.distanceToSquared(this.origin))[0];
    if (target === undefined) return;
    const hit = this.ports.combat.hit({ source: this.ports.actor, sourceTags: attack.tags, target: target.actor,
      amount: attack.damage, from: this.origin, point: target.aimPoint, dir: this.direction, weaponId: this.spec.id, moveId: attack.id, headshot: false });
    if (hit === null) return;
    if (attack.effect !== null && target.actor.alive) this.ports.effect(target.actor, attack.effect, this.ports.actor);
    target.target.hitFlash?.(1); this.notify('hit', { kind: target.target.kind, headshot: false, killed: hit.killed });
  }
  /** Detached state, including queued commands; snapshot adapters use this beside the shared script lane. */
  snapshot(): ItemState { return structuredClone({ version: 1, id: this.spec.id, tick: this.tick, cooldown: this.cooldown, fuel: this.fuel, lit: this.lit, held: this.held, chargeTime: this.chargeTime, pending: this.pending }); }
  /** Validate all fields before replacing live state. */
  restore(saved: ItemState): void {
    if (saved.version !== 1 || saved.id !== this.spec.id || !Number.isSafeInteger(saved.tick) || saved.tick < -1
      || !Number.isFinite(saved.cooldown) || saved.cooldown < 0 || !Number.isFinite(saved.fuel) || saved.fuel < 0 || saved.fuel > 1
      || typeof saved.held !== 'boolean' || !Number.isFinite(saved.chargeTime) || saved.chargeTime < 0 || (this.spec.kind === 'tool' && (saved.held || saved.chargeTime !== 0))
      || typeof saved.lit !== 'boolean' || (this.spec.kind === 'weapon' && saved.lit) || (saved.fuel === 0 && saved.lit)
      || saved.pending.length > 16 || saved.pending.some((c) => ![1, 2, 3, 4].includes(c.action) || (this.spec.kind === 'weapon' && (c.action >= 3 || c.aim === null))
        || (this.spec.kind === 'tool' && c.action < 3) || (c.aim !== null && !finiteAim(c.aim)))) throw new RangeError('Invalid item snapshot');
    const copy = structuredClone(saved); this.tick = copy.tick; this.cooldown = copy.cooldown; this.fuel = copy.fuel; this.lit = copy.lit; this.held = copy.held; this.chargeTime = copy.chargeTime; this.pending = copy.pending;
  }
}
