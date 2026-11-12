import * as v from 'valibot';
import { Vector3 } from 'three';
import { BossBrain, type BossSaved, type BossPresentation } from '../../../shared/engine/ai/BossBrain';
import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { SimHost, SimValue } from '../sim';
import type { DamageRequest } from '../../../shared/engine/combat/pipeline';
import { BossContenders } from './bossContenders';
import { NO_MOMENTS, publishEncounter } from '../../../shared/engine/sim/encounterRows';

/** One ordered phase: health threshold, steering and a presentation caption, authored without callbacks. */
export interface EncounterPhase { at: number; name: string; caption: string; speed: number; stopDistance: number; turnRate: number }
/** Elite and boss fights share this data table; zero intro and one phase describes the simple elite. */
export interface PhaseEncounterSpec {
  id: string; entity: string; kind: 'elite' | 'boss'; panel: string | null; name: string; title: string; retry: string;
  arena: { at: readonly [number, number, number]; radius: number }; intro: number; introShort: number;
  respawn: { at: readonly [number, number, number]; yaw: number }; phases: readonly EncounterPhase[];
}
/** Profile/instance persistence and rewards arrive through explicit platform ports. No shard save is imported. */
export interface PhaseEncounterPorts { saved: BossSaved; persist: (saved: BossSaved) => void; reward: () => void; presentation?: BossPresentation }
const finite = v.pipe(v.number(), v.finite(), v.minValue(0));
const natural = v.pipe(finite, v.integer());
const continuation = v.strictObject({ state: v.picklist(['dormant', 'armed', 'intro', 'fight', 'beat', 'victory']), phase: natural, checkpoint: natural, attempts: natural, t: finite, skipT: finite, short: v.boolean(), saved: v.strictObject({ defeated: v.boolean(), rewardTaken: v.boolean(), kills: natural }) });
const checkpointSchema = v.strictObject({ contract: v.string(), boss: continuation, shield: v.boolean(), engaged: v.exactOptional(natural), guard: v.exactOptional(v.picklist([1, 2, 3])) });
/** TE-ENG1: an encounter's damage window, set by its decision as `Do.encounter(ENCOUNTER_GUARD_VERB, guard)`. Which hits on
 *  the body land: `open` every hit (the default), `shut` none, `melee` only melee hits (`dmg.melee`: sword, spear),
 *  `ranged` only the others (shots, arrows). Reset to `open` at every checkpoint reset and at victory. */
export const ENCOUNTER_GUARD: Readonly<{ open: 0; shut: 1; melee: 2; ranged: 3 }> = Object.freeze({ open: 0, shut: 1, melee: 2, ranged: 3 });
export const ENCOUNTER_GUARD_VERB = 4;
function guardAdmits(guard: number, request: DamageRequest): boolean {
  if (guard === ENCOUNTER_GUARD.open) return true;
  if (guard === ENCOUNTER_GUARD.shut) return false;
  return request.sourceTags.includes('dmg.melee') === (guard === ENCOUNTER_GUARD.melee);
}
/** Renderer-free boss presentation records; the real declared panel can implement exactly the same ports. */
export function silentBossPresentation(): BossPresentation {
  let shown = false;
  return { update: () => undefined, get barShown() { return shown; }, hideBar: () => { shown = false; }, hideNameCard: () => undefined, hideReward: () => undefined,
    showRetry: () => undefined, showNameCard: () => undefined, setSkip: () => undefined, showBar: () => { shown = true; }, setHp: () => undefined, setShield: () => undefined, setPhase: () => undefined };
}
/** Data-driven encounter over today's phase/checkpoint/retry machinery and the real damage pipeline. */
export class PhaseEncounter {
  readonly boss: BossBrain;
  private shield = false;
  private guard = 0;
  private readonly spec: PhaseEncounterSpec;
  private readonly contract: string;
  private readonly actor: AnimalSim;
  private readonly presentation: BossPresentation;
  private readonly party: BossContenders;
  constructor(sim: SimHost, spec: PhaseEncounterSpec, ports: PhaseEncounterPorts, decisionOwned = false) {
    const actor = sim.entities.get(spec.entity);
    if (![ports.saved.defeated, ports.saved.rewardTaken].every((n) => typeof n === 'boolean') || !Number.isSafeInteger(ports.saved.kills) || ports.saved.kills < 0) throw new Error('Invalid encounter persistence');
    if (!actor || spec.phases.length === 0 || spec.phases[0]?.at !== 1 || spec.phases.some((p, i) => ![p.at, p.speed, p.stopDistance, p.turnRate].every(Number.isFinite) || p.at <= 0 || p.at > 1 || p.speed < 0 || p.speed > 15 || p.stopDistance < 0 || p.turnRate < 0 || (i > 0 && p.at >= (spec.phases[i - 1]?.at ?? 0)))
      || !Number.isFinite(spec.arena.radius) || spec.arena.radius <= 0 || spec.arena.radius > 500 || ![...spec.arena.at, ...spec.respawn.at, spec.respawn.yaw, spec.intro, spec.introShort].every(Number.isFinite) || spec.intro < 0 || spec.introShort < 0) throw new Error('Invalid phase encounter');
    this.actor = actor; this.spec = structuredClone(spec); this.contract = JSON.stringify(this.spec); this.presentation = ports.presentation ?? silentBossPresentation();
    const focus = new Vector3(...spec.arena.at), saved = { ...ports.saved };
    const party = this.party = new BossContenders(sim.players, (point) => point.distanceTo(focus) < spec.arena.radius, (player, position, yaw) => {
      player.position.copy(position); player.yaw = yaw; player.health.attributes.health = player.health.attributes.maxHealth;
    });
    const phase = (): EncounterPhase => { const value = this.spec.phases[this.boss.phase]; if (!value) throw new Error('Missing encounter phase'); return value; };
    this.boss = new BossBrain({ id: spec.id, name: spec.name, title: spec.title, retryTitle: spec.retry, intro: spec.intro, introShort: spec.introShort,
      phases: spec.phases.map((p) => ({ at: p.at, name: p.name, caption: p.caption })), reward: {} }, {
      inArena: (point) => point.distanceTo(focus) < spec.arena.radius,
      reset: (index) => { const value = spec.phases[index]; if (!value) throw new Error('Missing checkpoint'); actor.hp = actor.maxHp * value.at; actor.alive = true; actor.cancelAttack(); sim.strikes.get(actor.entityId)?.cancel(); actor.setMotion(actor.yaw, 0, 4); this.guard = ENCOUNTER_GUARD.open; },
      seal: () => undefined, intro: () => focus, begin: () => undefined, enterPhase: () => undefined,
      update: (_dt, _t, fighting) => {
        if (decisionOwned) return;
        const foe = sim.nearestPlayer(actor.position), player = foe.position, tune = phase(), dx = player.x - actor.position.x, dz = player.z - actor.position.z;
        actor.setMotion(Math.atan2(dx, dz), fighting && actor.alive && Math.hypot(dx, dz) > tune.stopDistance ? tune.speed : 0, tune.turnRate);
        if (fighting && actor.alive && foe.health.alive) sim.startStrike(actor.entityId, foe.id);
      }, get hpFrac() { return actor.hp / actor.maxHp; }, get shielded() { return false; }, get dead() { return !actor.alive; },
      clampHp: (fraction) => { actor.hp = actor.maxHp * fraction; }, setInvulnerable: (on) => { this.shield = on; },
      victory: () => { actor.setMotion(actor.yaw, 0, 4); this.guard = ENCOUNTER_GUARD.open; }, rewardPoint: () => focus,
      respawnPoint: () => ({ pos: new Vector3(...spec.respawn.at), yaw: spec.respawn.yaw }),
    }, { events: sim.events, player: party.player, lockInput: () => undefined, respawn: party.respawn,
      skipHeld: () => false, faceToward: () => undefined, spawnReward: ports.reward, persist: (value) => { ports.persist({ ...value }); },
    }, this.presentation, saved);
    sim.events.answer('damage.modify', (request) => {
      if (request === null) return null;
      if (this.boss.state === 'intro' && request.source !== 'env' && sim.players.has(request.source.id)) return null;
      if (request.target !== actor.combatActor()) return request;
      if (this.shield || this.boss.state !== 'fight' || !guardAdmits(this.guard, request)) return null;
      const next = this.spec.phases[this.boss.phase + 1];
      // A large hit cannot skip a checkpoint or kill through the next phase threshold.
      const scaled = party.scaled(request);
      return next ? { ...scaled, amount: Math.min(scaled.amount, Math.max(0, actor.hp - actor.maxHp * next.at)) } : scaled;
    }, sim.scope, { order: 100 });
    sim.events.on('damage.dealt', ({ req }) => { if (req.source === actor.combatActor()) party.echo(req, actor, sim.combat); }, sim.scope);
    sim.events.on('actor.died', ({ actor: dead }) => { if (sim.players.size > 1) party.fell(dead.id, this.boss); else if (sim.players.has(dead.id)) this.boss.onPlayerDeath(); }, sim.scope);
    sim.onStep(`encounter.${spec.id}`, (_dt) => { party.observe(this.boss); this.boss.update(1 / 60, sim.clock.now); }, { snapshot: () => this.snapshot(), restore: (value) => { this.restore(value); } });
    sim.scope.onDispose(() => { this.boss.disarm(); }); this.boss.arm();
    publishEncounter(sim, spec.id, () => ({ ...NO_MOMENTS, kind: spec.kind === 'boss' ? 'boss' : 'elite', state: this.boss.state, hp: actor.hp / actor.maxHp, phase: this.boss.phase, shield: this.shield, body: actor.entityId }));
  }
  /** Damage modification and phase transitions use the existing shared combat/clock; no raw health callback is authored. */
  snapshot(): SimValue { const { engaged } = this.party; return JSON.stringify({ contract: this.contract, boss: this.boss.snapshot(), shield: this.shield, ...(engaged === 0 ? {} : { engaged }), ...(this.guard === 0 ? {} : { guard: this.guard }) }); }
  /** Restore does not grant rewards or persist again; presentation is refreshed from the recovered phase. */
  restore(value: SimValue): void {
    if (typeof value !== 'string') throw new Error('Invalid encounter snapshot');
    const input: unknown = JSON.parse(value), saved = v.parse(checkpointSchema, input);
    if (saved.contract !== this.contract) throw new Error('Incompatible encounter snapshot');
    this.boss.restore(saved.boss); this.shield = saved.shield; this.guard = saved.guard ?? ENCOUNTER_GUARD.open; this.party.restoreEngaged(saved.engaged ?? 0);
    this.presentation.hideBar(); this.presentation.hideNameCard(); this.presentation.hideReward();
    if (this.boss.state === 'fight' || this.boss.state === 'beat') {
      const phase = this.spec.phases[this.boss.phase];
      this.presentation.showBar(this.spec.name, this.spec.phases.slice(1).map((p) => p.at)); this.presentation.setHp(this.actor.hp / this.actor.maxHp);
      this.presentation.setShield(this.shield); if (phase) this.presentation.setPhase(this.boss.phase, phase.caption);
    } else if (this.boss.state === 'intro') this.presentation.showNameCard(this.spec.name, this.spec.title, saved.boss.short);
  }
  /** Explicit death/checkpoint hook for a host that resolves death before its queued notification. */
  retry(): boolean { return this.boss.onPlayerDeath(); }
  /** Read-only batch validation; the DecisionHost commits only after every command passes. */
  validateDecision(verb: number, value: number): void {
    if (verb !== ENCOUNTER_GUARD_VERB) { this.boss.validateDecision(verb, value); return; }
    if (!Number.isSafeInteger(value) || value < ENCOUNTER_GUARD.open || value > ENCOUNTER_GUARD.ranged) throw new Error('Invalid encounter guard');
  }
  /** Apply on the next fixed step through the current checkpoint/reward owner; the guard is this encounter's own. */
  applyDecision(verb: number, value: number): void {
    this.validateDecision(verb, value);
    if (verb === ENCOUNTER_GUARD_VERB) this.guard = value; else this.boss.applyDecision(verb, value);
  }
}
