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
  arena: { at: readonly [number, number, number]; radius: number; bounds?: EncounterBounds }; intro: number; introShort: number;
  respawn: { at: readonly [number, number, number]; yaw: number }; phases: readonly EncounterPhase[];
  /** OF34b: how the fight starts (absent: `placed`), and whether the boss's blows skip the fight cap. */
  start?: EncounterStart; capExempt?: true;
}
/** ONE-FORMAT OF34a/OF34b (J420 (1)): `placed` stands from load (as before); `spawned` has no body until a player enters the
 *  arena; `resident` fights from the first player blow, wherever it stands. */
export type EncounterStart = 'placed' | 'spawned' | 'resident';
/** `room`: the fight resets once every contender has left the arena; `open`: once the boss is drawn past its radius. */
export type EncounterBounds = 'room' | 'open';
/** Where a spawned boss waits before its fight: under every floor, as an absent declared spawn does (`declaredSpawnWhen`). */
const ABSENT_Y = -1e4;
/** Profile/instance persistence and rewards arrive through explicit platform ports. No shard save is imported. */
export interface PhaseEncounterPorts { saved: BossSaved; persist: (saved: BossSaved) => void; reward: () => void; presentation?: BossPresentation;
  /** OF19c0: a quest page summons this fight: it waits dormant (a spawned boss out of the world) until `summon` arms it. */
  summoned?: boolean;
  /** OF20c: the fight's own victory, each win, before its record persists and its first reward (a runtime plan's owner row
   *  files its flag and fact here). */
  victory?: () => void }
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
  /** OF34b: a resident boss was struck while armed; a spawned boss is out of the world. */
  private struck = false;
  private absent = false;
  private readonly settleSpawn: (restoring?: boolean) => void;
  constructor(sim: SimHost, spec: PhaseEncounterSpec, ports: PhaseEncounterPorts, decisionOwned = false) {
    const actor = sim.entities.get(spec.entity);
    if (![ports.saved.defeated, ports.saved.rewardTaken].every((n) => typeof n === 'boolean') || !Number.isSafeInteger(ports.saved.kills) || ports.saved.kills < 0) throw new Error('Invalid encounter persistence');
    if (!actor || spec.phases.length === 0 || spec.phases[0]?.at !== 1 || spec.phases.some((p, i) => ![p.at, p.speed, p.stopDistance, p.turnRate].every(Number.isFinite) || p.at <= 0 || p.at > 1 || p.speed < 0 || p.speed > 15 || p.stopDistance < 0 || p.turnRate < 0 || (i > 0 && p.at >= (spec.phases[i - 1]?.at ?? 0)))
      || !Number.isFinite(spec.arena.radius) || spec.arena.radius <= 0 || spec.arena.radius > 500 || ![...spec.arena.at, ...spec.respawn.at, spec.respawn.yaw, spec.intro, spec.introShort].every(Number.isFinite) || spec.intro < 0 || spec.introShort < 0) throw new Error('Invalid phase encounter');
    this.actor = actor; this.spec = structuredClone(spec); this.contract = JSON.stringify(this.spec); this.presentation = ports.presentation ?? silentBossPresentation();
    const focus = new Vector3(...spec.arena.at), saved = { ...ports.saved };
    const start = spec.start ?? 'placed', bounds = spec.arena.bounds, home = actor.position.clone(), homeYaw = actor.yaw;
    if (spec.capExempt === true) actor.capExempt = true; // OF34b: the boss's blows skip the fight cap
    // A resident or open-ground boss fights wherever it stands: its contenders are the players near its body.
    const nearBody = start === 'resident' || bounds === 'open';
    const inside = (point: Vector3): boolean => point.distanceTo(nearBody ? actor.position : focus) < spec.arena.radius;
    const party = this.party = new BossContenders(sim.players, inside, (player, position, yaw) => {
      player.position.copy(position); player.yaw = yaw; player.health.attributes.health = player.health.attributes.maxHealth;
    }, { served: () => sim.respawn.served, rearm: true }, sim.parked);
    // AC6: a form a script's `despawn` holds out of the world (hidden, not alive) is neither beaten nor revived by its fight
    const held = (): boolean => 'hidden' in actor && actor.hidden === true;
    const phase = (): EncounterPhase => { const value = this.spec.phases[this.boss.phase]; if (!value) throw new Error('Missing encounter phase'); return value; };
    this.boss = new BossBrain({ id: spec.id, name: spec.name, title: spec.title, retryTitle: spec.retry, intro: spec.intro, introShort: spec.introShort,
      phases: spec.phases.map((p) => ({ at: p.at, name: p.name, caption: p.caption })), reward: {} }, {
      // OF34b: a resident boss's fight starts at the first player blow, never by standing in its arena
      inArena: (point) => start === 'resident' ? this.struck : point.distanceTo(focus) < spec.arena.radius,
      reset: (index) => { const value = spec.phases[index]; if (!value) throw new Error('Missing checkpoint'); this.struck = false; actor.hp = actor.maxHp * value.at; actor.alive = !held(); actor.cancelAttack(); sim.strikes.get(actor.entityId)?.cancel(); actor.setMotion(actor.yaw, 0, 4); this.guard = ENCOUNTER_GUARD.open; },
      seal: () => undefined, intro: () => focus, begin: () => undefined, enterPhase: () => undefined,
      update: (_dt, _t, fighting) => {
        if (decisionOwned) return;
        const foe = sim.nearestPlayer(actor.position), player = foe.position, tune = phase(), dx = player.x - actor.position.x, dz = player.z - actor.position.z;
        actor.setMotion(Math.atan2(dx, dz), fighting && actor.alive && Math.hypot(dx, dz) > tune.stopDistance ? tune.speed : 0, tune.turnRate);
        if (fighting && actor.alive && foe.health.alive) sim.startStrike(actor.entityId, foe.id);
      }, get hpFrac() { return actor.hp / actor.maxHp; }, get shielded() { return false; }, get dead() { return !actor.alive && !held(); },
      clampHp: (fraction) => { actor.hp = actor.maxHp * fraction; }, setInvulnerable: (on) => { this.shield = on; },
      victory: () => { actor.setMotion(actor.yaw, 0, 4); this.guard = ENCOUNTER_GUARD.open; ports.victory?.(); }, rewardPoint: () => focus,
      respawnPoint: () => ({ pos: new Vector3(...spec.respawn.at), yaw: spec.respawn.yaw }),
    }, { events: sim.events, player: party.player, lockInput: () => undefined, respawn: party.respawn,
      skipHeld: () => false, faceToward: () => undefined, spawnReward: ports.reward, persist: (value) => { ports.persist({ ...value }); },
    }, this.presentation, saved);
    sim.events.answer('damage.modify', (request) => {
      if (request === null) return null;
      if (this.boss.state === 'intro' && request.source !== 'env' && sim.players.has(request.source.id)) return null;
      if (request.target !== actor.combatActor()) return request;
      if (start === 'resident' && this.boss.state === 'armed' && request.source !== 'env' && sim.players.has(request.source.id)) this.struck = true;
      if (this.shield || this.boss.state !== 'fight' || !guardAdmits(this.guard, request)) return null;
      const next = this.spec.phases[this.boss.phase + 1];
      // A large hit cannot skip a checkpoint or kill through the next phase threshold.
      const scaled = party.scaled(request);
      return next ? { ...scaled, amount: Math.min(scaled.amount, Math.max(0, actor.hp - actor.maxHp * next.at)) } : scaled;
    }, sim.scope, { order: 100 });
    sim.events.on('damage.dealt', ({ req }) => { if (req.source === actor.combatActor()) party.echo(req, actor, sim.combat); }, sim.scope);
    sim.events.on('actor.died', ({ actor: dead }) => { if (sim.players.size > 1) party.fell(dead.id, this.boss); else if (sim.players.has(dead.id)) this.boss.onPlayerDeath(); }, sim.scope);
    // OF19d: a room's death the engaged fight owns is the fight's to place (`fell`, at `respawn`), as a boss row's is; unanswered,
    // the room's J107 respawn put the fallen at their last place or the shard's spawn instead (Dunes: 150 m from the basin).
    sim.events.answer('death.checkpoint', (value) => value === true || (sim.players.size > 1 && this.boss.engaged), sim.scope);
    // SB51: a beaten fight whose body its spawn row brought back (`respawn`) stands again with it: a body that stands is a fight
    // a newcomer can damage and win, never a victory waiting on an empty arena. A cell's sleep spends that empty wait (SC10).
    sim.events.on('world.slept', ({ seconds }) => { party.slept(seconds); }, sim.scope);
    /** OF34b: a spawned boss is out of the world while its fight waits (armed or dormant) and stands at home once it begins. */
    this.settleSpawn = (restoring = false): void => {
      if (start !== 'spawned') return;
      const waiting = this.boss.state === 'armed' || this.boss.state === 'dormant';
      if (waiting && !this.absent) {
        this.absent = true; Object.assign(actor, { hidden: true }); actor.alive = false; actor.position.y = ABSENT_Y; actor.motor?.resetAt?.(actor.position);
      } else if (this.boss.engaged && this.absent) {
        this.absent = false; Object.assign(actor, { hidden: false });
        if (!restoring) actor.place(home.x, home.z, homeYaw, home.y); // a restored body keeps its saved place
        actor.alive = true; actor.motor?.resetAt?.(actor.position);
      }
    };
    const reset = (): void => { this.boss.disarm(); this.boss.arm(); };
    sim.onStep(`encounter.${spec.id}`, (_dt) => {
      if (this.boss.state === 'victory' && actor.alive) { this.boss.returnBeaten(); this.boss.arm(); }
      party.observe(this.boss);
      // OF34b bounds: `room` once nobody is inside (a room of several already resets in `observe`), `open` once the boss is drawn out
      if (this.boss.engaged && bounds === 'room' && ![...sim.players.values()].some(player => inside(player.position))) reset();
      if (this.boss.engaged && bounds === 'open' && actor.position.distanceTo(focus) > spec.arena.radius) {
        reset(); actor.place(home.x, home.z, homeYaw, home.y); actor.motor?.resetAt?.(actor.position);
      }
      this.boss.update(1 / 60, sim.clock.now);
      this.settleSpawn();
    }, { snapshot: () => this.snapshot(), restore: (value) => { this.restore(value); } });
    sim.scope.onDispose(() => { this.boss.disarm(); }); if (ports.summoned !== true) this.boss.arm(); this.settleSpawn();
    publishEncounter(sim, spec.id, () => ({ ...NO_MOMENTS, kind: spec.kind === 'boss' ? 'boss' : 'elite', state: this.boss.state, hp: actor.hp / actor.maxHp, phase: this.boss.phase, shield: this.shield, body: actor.entityId }));
  }
  /** Damage modification and phase transitions use the existing shared combat/clock; no raw health callback is authored. */
  snapshot(): SimValue { const { engaged } = this.party; return JSON.stringify({ contract: this.contract, boss: this.boss.snapshot(), shield: this.shield, ...(engaged === 0 ? {} : { engaged }), ...(this.guard === 0 ? {} : { guard: this.guard }) }); }
  /** Restore does not grant rewards or persist again; presentation is refreshed from the recovered phase. */
  restore(value: SimValue): void {
    if (typeof value !== 'string') throw new Error('Invalid encounter snapshot');
    const input: unknown = JSON.parse(value), saved = v.parse(checkpointSchema, input);
    if (saved.contract !== this.contract) throw new Error('Incompatible encounter snapshot');
    this.boss.restore(saved.boss); this.settleSpawn(true); this.shield = saved.shield; this.guard = saved.guard ?? ENCOUNTER_GUARD.open; this.party.restoreEngaged(saved.engaged ?? 0);
    this.presentation.hideBar(); this.presentation.hideNameCard(); this.presentation.hideReward();
    if (this.boss.state === 'fight' || this.boss.state === 'beat') {
      const phase = this.spec.phases[this.boss.phase];
      this.presentation.showBar(this.spec.name, this.spec.phases.slice(1).map((p) => p.at)); this.presentation.setHp(this.actor.hp / this.actor.maxHp);
      this.presentation.setShield(this.shield); if (phase) this.presentation.setPhase(this.boss.phase, phase.caption);
    } else if (this.boss.state === 'intro') this.presentation.showNameCard(this.spec.name, this.spec.title, saved.boss.short);
  }
  /** OF19c0: the quest page's summon arms a fight that waits for it (a no-op once it is armed or fought). */
  summon(): void { if (this.boss.state === 'dormant') this.boss.arm(); }
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
