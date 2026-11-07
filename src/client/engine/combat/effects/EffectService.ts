import { PlayerHealth } from '../../../../shared/engine/combat/health';
import type { Scope } from '../../../../shared/engine/app/scope';
import { Vector3 } from 'three';
import type { Events } from '../../../../shared/engine/events/events';
import type { Actor, CombatPipeline, CombatTag } from '../../../../shared/engine/combat/pipeline';
import { harmfulEffect, matchesTag, type ActiveEffect, type AttributeSet, type EffectDef, type EffectId, type EffectTarget } from './types';

declare module '../../events/maps' {
  interface EventMap {
    'effect.applied': { target: EffectTarget; id: EffectId };
    'effect.removed': { target: EffectTarget; id: EffectId };
  }
}

const playerBindings = new WeakMap<EffectService, WeakMap<Actor, { movement: object; scope: Scope }>>();

/** Bind player-owned movement channels and periodic damage once for the same player/service lifetime. */
export function bindPlayerEffects(o: { effects: EffectService; target: Actor;
  movement: { effectMoveLocked: boolean; effectMoveScale: number; dodgeCooldownScale?: number };
  combat: CombatPipeline; position: () => Vector3; scope: Scope }): void {
  const { effects, target, movement, scope } = o;
  let targets = playerBindings.get(effects);
  if (targets === undefined) { targets = new WeakMap(); playerBindings.set(effects, targets); }
  const prior = targets.get(target);
  if (prior !== undefined && !prior.scope.disposed) {
    if (prior.movement !== movement) throw new Error('Player effects already use another movement owner');
    return;
  }
  const binding = { movement, scope }; targets.set(target, binding);
  const active = targets;
  scope.onDispose(() => { if (active.get(target) === binding) active.delete(target); });
  effects.setBase(target, 'moveLocked', 0);
  effects.setBase(target, 'moveSpeedMul', 1);
  if (movement.dodgeCooldownScale !== undefined) effects.setBase(target, 'dodgeCooldownMul', 1);
  effects.bind(target, (previous) => {
    if (target instanceof PlayerHealth) {
      const max = target.attributes.maxHealth; target.attributes.maxHealth = previous['maxHealth'] ?? max; target.setMaxHealth(max);
    }
    if (movement.dodgeCooldownScale !== undefined) movement.dodgeCooldownScale = target.attributes['dodgeCooldownMul'] ?? 1;
    movement.effectMoveLocked = (target.attributes['moveLocked'] ?? 0) > 0;
    movement.effectMoveScale = target.attributes['moveSpeedMul'] ?? 1;
  }, scope);
  effects.onTick((recipient: EffectTarget, effect) => {
    const amount = effect.def.tickDamage;
    if (recipient !== target || amount === undefined || !target.alive) return;
    o.combat.hit({ source: effect.source ?? 'env', sourceTags: [...effect.sourceTags, effect.def.id, 'dmg.effect', 'through.walls'],
      target, amount: amount * effect.stacks, point: o.position(), dir: new Vector3(), throughWalls: true });
  }, scope);
  scope.onDispose(() => { movement.effectMoveLocked = false; movement.effectMoveScale = 1; });
}
interface TargetState {
  active: Map<EffectId, ActiveEffect>; bases: AttributeSet;
  changed: ((previous: AttributeSet) => void) | undefined; originalTags: readonly CombatTag[];
}
export class EffectService {
  private readonly definitions = new Map<EffectId, EffectDef>();
  private readonly targets = new Map<EffectTarget, TargetState>();
  private readonly events: Events | undefined;
  private readonly tick: ((target: EffectTarget, effect: ActiveEffect) => void) | undefined;
  private disposed = false;
  private readonly tickListeners = new Set<(target: EffectTarget, effect: ActiveEffect) => void>();
  onTick(fn: (target: EffectTarget, effect: ActiveEffect) => void, scope: Scope): void {
    this.tickListeners.add(fn); scope.onDispose(() => { this.tickListeners.delete(fn); });
  }
  constructor(defs: readonly EffectDef[], scope?: Scope, events?: Events, tick?: (target: EffectTarget, effect: ActiveEffect) => void) {
    this.events = events; this.tick = tick;
    for (const def of defs) {
      if (this.definitions.has(def.id)) throw new Error(`Duplicate effect ${def.id}`);
      if (def.kind === 'timed' && (def.duration === undefined || def.duration <= 0)) throw new Error(`Effect ${def.id} needs a duration`);
      if (typeof def.stacking === 'object' && (!Number.isInteger(def.stacking.max) || def.stacking.max < 1)) throw new Error(`Invalid effect stacks ${def.id}`);
      if (def.period !== undefined && def.period <= 0) throw new Error(`Invalid effect period ${def.id}`);
      this.definitions.set(def.id, def);
    }
    scope?.onDispose(() => { for (const target of this.targets.keys()) this.clear(target); this.disposed = true; });
  }

  /** Admit another level's effect declarations into the shared player service; conflicting IDs refuse before mutation. */
  registerDefinitions(defs: readonly EffectDef[]): void {
    if (this.disposed) throw new Error('Effect service is disposed');
    const staged = new Map<EffectId, EffectDef>();
    for (const def of defs) {
      const prior = staged.get(def.id) ?? this.definitions.get(def.id);
      if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(def)) throw new Error(`Conflicting effect ${def.id}`);
      if (def.kind === 'timed' && (def.duration === undefined || def.duration <= 0)) throw new Error(`Effect ${def.id} needs a duration`);
      if (typeof def.stacking === 'object' && (!Number.isInteger(def.stacking.max) || def.stacking.max < 1)) throw new Error(`Invalid effect stacks ${def.id}`);
      if (def.period !== undefined && def.period <= 0) throw new Error(`Invalid effect period ${def.id}`);
      staged.set(def.id, def);
    }
    for (const [id, def] of staged) if (!this.definitions.has(id)) this.definitions.set(id, def);
  }
  private state(target: EffectTarget): TargetState {
    let state = this.targets.get(target);
    if (state === undefined) {
      state = { active: new Map(), bases: {}, changed: undefined, originalTags: target.effectTags ?? [] };
      this.targets.set(target, state);
    }
    return state;
  }
  /** Detach an entered observer without clearing player-owned statuses when clearOnDispose is false. */
  bind(target: EffectTarget, changed: (previous: AttributeSet) => void, scope?: Scope, options: { clearOnDispose?: boolean } = {}): void {
    const state = this.state(target), previous = state.changed;
    state.changed = changed;
    scope?.onDispose(() => {
      if (options.clearOnDispose !== false) this.clear(target);
      else if (state.changed === changed) state.changed = previous;
    });
  }
  private recompute(target: EffectTarget, state: TargetState): void {
    const previous = { ...target.attributes };
    for (const [attr, base] of Object.entries(state.bases)) {
      let value = base ?? 0;
      for (const effect of state.active.values()) for (let stack = 0; stack < effect.stacks; stack++) {
        for (const mod of effect.def.modifiers) if (mod.attr === attr) value = mod.op === 'add' ? value + mod.value : mod.op === 'mul' ? value * mod.value : mod.value;
      }
      target.attributes[attr] = value;
    }
    target.effectTags = [...new Set([...state.originalTags, ...[...state.active.values()].flatMap((effect) => effect.def.grants ?? [])])];
    state.changed?.(previous);
  }
  setBase(target: EffectTarget, attr: string, value: number): void {
    if (this.disposed) return;
    const state = this.state(target); state.bases[attr] = value; this.recompute(target, state);
  }
  apply(target: EffectTarget, id: EffectId, source?: Actor, options: { duration?: number; sourceTags?: readonly CombatTag[] } = {}): void {
    if (this.disposed) return;
    const def = this.definitions.get(id);
    if (def === undefined) throw new Error(`Unknown effect ${id}`);
    if (def.blockedBy?.some((tag) => this.has(target, tag))) return;
    const duration = options.duration ?? def.duration ?? 0;
    if (def.kind === 'timed' && (!Number.isFinite(duration) || duration <= 0)) throw new Error(`Invalid duration for ${id}`);
    const state = this.state(target);
    for (const remove of def.removes ?? []) this.remove(target, remove);
    if (def.group !== undefined) for (const active of state.active.values()) {
      if (active.def.id !== id && active.def.group === def.group) this.remove(target, active.def.id);
    }
    if (def.kind === 'instant') {
      const previous = { ...target.attributes };
      for (const mod of def.modifiers) {
        const base = target.attributes[mod.attr] ?? 0;
        target.attributes[mod.attr] = mod.op === 'add' ? base + mod.value : mod.op === 'mul' ? base * mod.value : mod.value;
        if (Object.hasOwn(state.bases, mod.attr)) state.bases[mod.attr] = target.attributes[mod.attr];
      }
      state.changed?.(previous); this.events?.emit('effect.applied', { target, id }); return;
    }
    const current = state.active.get(id);
    if (current !== undefined) {
      if (typeof def.stacking === 'object') current.stacks = Math.min(def.stacking.max, current.stacks + 1);
      if (def.kind === 'timed') current.remaining = Math.max(current.remaining, duration);
      current.source = source; current.sourceTags = options.sourceTags ?? [];
    } else {
      for (const mod of def.modifiers) if (!Object.hasOwn(state.bases, mod.attr)) state.bases[mod.attr] = target.attributes[mod.attr] ?? 0;
      state.active.set(id, { def, stacks: 1, remaining: def.kind === 'permanent' ? Infinity : duration, elapsed: 0, source, sourceTags: options.sourceTags ?? [] });
    }
    this.recompute(target, state); this.events?.emit('effect.applied', { target, id });
  }
  /** Set permanent loadout grants exactly; repeated save/menu notifications are idempotent. */
  sync(target: EffectTarget, grants: readonly { id: EffectId; stacks?: number }[]): void {
    if (this.disposed) return;
    const want = new Set(grants.map((grant) => grant.id));
    const state = this.state(target);
    for (const [id, effect] of state.active) if (effect.def.kind === 'permanent' && !want.has(id)) this.remove(target, id);
    for (const grant of grants) {
      const current = state.active.get(grant.id);
      if (current === undefined) this.apply(target, grant.id);
      const effect = state.active.get(grant.id);
      if (effect !== undefined && typeof effect.def.stacking === 'object') effect.stacks = Math.min(effect.def.stacking.max, Math.max(1, grant.stacks ?? 1));
    }
    this.recompute(target, state);
  }
  remove(target: EffectTarget, id: EffectId): void {
    const state = this.targets.get(target);
    if (state === undefined || !state.active.delete(id)) return;
    this.recompute(target, state); this.events?.emit('effect.removed', { target, id });
  }
  /** Remove harmful statuses through normal notifications, preserving every buff's stacks, clock and source. */
  clearHarmful(target: EffectTarget): void {
    const bases = this.targets.get(target)?.bases;
    for (const effect of this.active(target)) if (harmfulEffect(effect.def, bases)) this.remove(target, effect.def.id);
  }
  clear(target: EffectTarget): void {
    const state = this.targets.get(target);
    if (state === undefined) return;
    for (const id of state.active.keys()) this.remove(target, id);
    this.targets.delete(target);
  }
  has(target: EffectTarget, tag: CombatTag): boolean { return matchesTag(target.effectTags ?? [], tag); }
  active(target: EffectTarget): readonly ActiveEffect[] { return [...(this.targets.get(target)?.active.values() ?? [])]; }
  update(dt: number): void {
    if (this.disposed || dt <= 0) return;
    for (const [target, state] of this.targets) for (const effect of state.active.values()) {
      if (effect.def.kind !== 'timed') continue;
      const span = Math.min(dt, effect.remaining);
      effect.remaining = Math.max(0, effect.remaining - dt); effect.elapsed += span;
      const period = effect.def.period;
      if (period !== undefined) while (effect.elapsed + 1e-12 >= period) {
        effect.elapsed = Math.max(0, effect.elapsed - period);
        this.tick?.(target, effect); for (const fn of this.tickListeners) fn(target, effect);
      }
      if (effect.remaining <= 1e-12) this.remove(target, effect.def.id);
    }
  }
}

/** Authored permanent grant selection; the caller retains ownership and worn-state storage. */
export interface EffectGrantRow<Key extends string> {
  readonly id: EffectId;
  readonly key: Key;
  readonly unless?: readonly Key[];
  readonly stacks?: number;
}

/** Select from a data-only ownership set in authored order, without applying effects or changing ownership. */
export function selectEffectGrants<Key extends string>(rows: readonly EffectGrantRow<Key>[], owned: ReadonlySet<Key>): { id: EffectId; stacks?: number }[] {
  const validKey = (key: string): boolean => key.length > 0 && key.length <= 256;
  if (rows.length > 128 || rows.some(row => !validKey(row.key) || (row.unless?.length ?? 0) > 32
    || row.unless?.some(key => !validKey(key)) === true
    || (row.stacks !== undefined && (!Number.isSafeInteger(row.stacks) || row.stacks <= 0)))) throw new Error('Invalid effect grant rows');
  const grants: { id: EffectId; stacks?: number }[] = [];
  for (const row of rows) if (owned.has(row.key) && row.unless?.some(key => owned.has(key)) !== true) {
    grants.push(row.stacks === undefined ? { id: row.id } : { id: row.id, stacks: row.stacks });
  }
  return grants;
}
