import * as v from 'valibot';
import { parseBossOwnerRow } from '@wildshard/format/bossProfiles';
import { DirectorBossBrain } from '../../../shared/game/plugin/director';
import { bossFlagRecord, type BossRecordRow } from '../../../shared/game/plugin/bossRecord';
import { BossBrain, type BossContinuation, type BossDefinition, type BossSaved, type BossScript } from '@wildshard/engine/ai/BossBrain';
import { silentBossPresentation } from '@wildshard/engine/ai/phases';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimBodyBands, SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import type { SpeciesProgramRows } from '../plugin/brain';
import { BossContenders } from '@wildshard/engine/ai/bossContenders';
import { BossBounty } from '../boss/bounty';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { NO_MOMENTS, publishEncounter, type EncounterReward } from '@wildshard/engine/sim/encounterRows';
import { sayFightView } from '@wildshard/engine/sim/shardRows';
import { BOSS_STRIKE } from '../../../shared/game/shardfile/wirePrompts';

/** What a boss row's encounter is given: its definition and view-free script, its body, its record and its fight state. */
export interface BossRowSpec {
  /** The encounter's fixed-step id; its continuation is `{ version: 1, boss: BossBrain's, fight: the script's }`. */
  readonly step: string;
  readonly definition: BossDefinition;
  /** Explicit encounter author; absent retains the original native continuation. */
  readonly stages?: unknown;
  readonly script: BossScript;
  /** The boss's live body (null between resets): a hit on it is refused while `shielded`. */
  readonly body: () => AnimalSim | null;
  /** The script's shield / invulnerability through a beat (the host's `damage.modify` refuses hits on the body). */
  readonly shielded: () => boolean;
  /** The script's own continuation beside BossBrain's; `restore` validates its own shape. */
  readonly fight: { readonly snapshot: () => unknown; readonly restore: (value: unknown) => void };
  /** The record to start from and how it persists (`bossFlagRecord`, or the shard's own). */
  readonly saved: BossSaved;
  readonly persist: (value: BossSaved) => void;
  /** The victory's reward (coins through the platform's effect port); the brain calls it on the first fall. */
  readonly spawnReward?: () => void;
  /** Armed at install (a boss that waits for the player in its arena); otherwise `summon` arms it. */
  readonly armed?: boolean;
  /** After a restore: re-adopt the body the host reinstalled, mirror the restored record. */
  readonly restored?: (boss: BossContinuation) => void;
  /** The tag an env-sourced hazard of this fight wears: its hits share to further players as the body's blows do (J104). */
  readonly hazardTag?: string;
  /** A player the brain just put back: the host's own part of the return (its motor, its kit). */
  readonly returned?: (player: PlayerSim) => void;
  /** Where the fight's reward waits to be taken, for a fight that leaves one lying. */
  readonly rewardPoint?: () => EncounterReward | null;
  /** The name a page reads this fight's row by, where it isn't `step`. */
  readonly row?: string;
}

const finite = v.pipe(v.number(), v.finite());
/** Authored presentation on the existing held/spawned boss runner. */
export interface BossViewRows {
  readonly id: string; readonly definition: BossDefinition; readonly stages: unknown; readonly profile: unknown;
  /** The fixed step a server publishes this fight's row under. */
  readonly row?: string;
  readonly presentation?: unknown; readonly reward: number;
  readonly record?: BossRecordRow;
  readonly victory: { readonly flag: string; readonly fact: string; readonly once: boolean; readonly again?: string; readonly rewardLabel?: string };
}
const Boss = v.strictObject({ state: v.picklist(['dormant', 'armed', 'intro', 'fight', 'beat', 'victory']), phase: finite, checkpoint: finite, attempts: finite, t: finite, skipT: finite, short: v.boolean(),
  director: v.exactOptional(v.string()),
  saved: v.strictObject({ defeated: v.boolean(), rewardTaken: v.boolean(), kills: finite }) });
const Saved = v.strictObject({ version: v.picklist([1, 2]), boss: Boss, fight: v.unknown(), engaged: v.exactOptional(finite), earners: v.exactOptional(v.array(v.string())) });

/**
 * A declared boss row's encounter in a renderer-free host (SHARD-PLATFORM SF72): the engine's `BossBrain` (arm, intro,
 * phase thresholds, beats, checkpoints, victory) over the shard's view-free script, with no views (the silent
 * presentation: the boss bar, name card, skip hold and toasts are the browser's). It answers the host's
 * `damage.modify` (no hit on the body while the script is shielded) and the health model's `death.checkpoint` (a player
 * death in the fight returns them to the script's respawn point and resets the boss to the checkpoint's phase), moves
 * the player for the brain's respawn / face-toward, and keeps the brain's and the script's continuation as one fixed
 * step. The player's weapons are locked through the intro (`locked`). Signal's Dune Matriarch and Sky Reach's Storm Roc
 * have this shape.
 */
export function installBossRow(host: SimHost, spec: BossRowSpec): { boss: BossBrain; party: BossContenders; bounty: BossBounty; summon: () => void; locked: () => boolean } {
  const party = new BossContenders(host.players, point => spec.script.inArena(point), (player, position, yaw) => { player.position.copy(position); player.yaw = yaw; spec.returned?.(player); },
    { served: () => host.respawn.served, rearm: spec.armed === true }, host.parked);
  const bounty = new BossBounty(host, spec.body, spec.step);
  host.events.on('world.slept', ({ seconds }) => { party.slept(seconds); }, host.scope);
  const ports = { events: host.events, player: party.player,
    lockInput: (on: boolean) => { if (actRoutes(host).introLocks === true) for (const player of host.players.values()) if (!on || spec.script.inArena(player.position)) player.moveScale = on ? 0 : 1; },
    skipHeld: () => actRoutes(host).skipHeld, respawn: party.respawn, faceToward: party.faceToward,
    spawnReward: () => { spec.spawnReward?.(); }, persist: spec.persist };
  const boss = spec.stages === undefined
    ? new BossBrain(spec.definition, spec.script, ports, silentBossPresentation(), spec.saved)
    : new DirectorBossBrain(spec.definition, spec.script, ports, silentBossPresentation(), spec.saved, spec.stages);
  host.events.answer('damage.modify', (request) => { const body = spec.body(); return request !== null && body !== null && request.target === body.combatActor() ? spec.shielded() ? null : party.scaled(request) : request; }, host.scope);
  host.events.on('damage.dealt', ({ req }) => { const body = spec.body(); if (body !== null && party.owns(req, body, spec.hazardTag)) party.echo(req, body, host.combat); }, host.scope);
  // A room asks first and acts on `player.died`, the one event that says who fell.
  host.events.answer('death.checkpoint', (value) => party.died(boss) || value === true, host.scope);
  host.events.on('player.died', ({ actor }) => { if (host.players.size > 1) party.fell(actor.id, boss); }, host.scope);
  if (spec.armed === true) boss.arm();
  host.onStep(spec.step, dt => {
    const body = spec.body(); if (body !== null) host.focusOn(body.position);
    party.observe(boss, dt);
    boss.update(dt, host.clock.now);
  }, {
    snapshot: () => { const { engaged } = party, { earned } = bounty; return JSON.stringify({ version: spec.stages === undefined ? 1 : 2, boss: boss.snapshot(), fight: spec.fight.snapshot(), ...(engaged === 0 ? {} : { engaged }), ...(earned.length === 0 ? {} : { earners: earned }) }); },
    restore: value => {
      if (typeof value !== 'string') throw new Error(`Invalid ${spec.step} continuation`);
      const state = v.parse(Saved, JSON.parse(value));
      if (state.version !== (spec.stages === undefined ? 1 : 2) || (state.boss.director === undefined) !== (spec.stages === undefined)) throw new Error('Incompatible boss stage continuation');
      boss.restore(state.boss); spec.fight.restore(state.fight); party.restoreEngaged(state.engaged ?? 0); bounty.restore(state.earners ?? []); spec.restored?.(state.boss);
    },
  });
  publishEncounter(host, spec.row ?? spec.step, () => ({ ...NO_MOMENTS, kind: 'boss', state: boss.state, hp: spec.script.hpFrac, phase: boss.phase, shield: spec.shielded() || boss.state === 'beat', body: spec.body()?.entityId ?? null, skip: boss.skipHeldFor, reward: spec.rewardPoint?.() ?? null }));
  return { boss, party, bounty, summon: () => { if (boss.state === 'dormant') boss.arm(); }, locked: () => boss.state === 'intro' };
}


/** Native effect ports are supplied by the host, never serialized callbacks. */
export interface BossOwnerPorts {
  readonly fact: (name: string, actorId: string) => void;
  readonly coins: (amount: number, actorId: string) => void;
}

/** What a declared encounter beside a runtime plan takes from the plan's owner row (`PhaseEncounterPorts` less its summon). */
export interface DeclaredOwnerHooks {
  readonly saved: BossSaved; readonly persist: (value: BossSaved) => void; readonly reward: () => void; readonly victory: () => void;
}
/**
 * ONE-FORMAT OF20c / OF19c1: a runtime plan's owner row naming a declared spawn binds that spawn's declared boss encounter,
 * as it bound the retired keeper's boss: each win sets the row's victory flag and files its fact (once, by
 * the flag, when `once`), its coins pay on the win or once as a claim (each earner once in a room, J105, keyed by the row's
 * step), its record is the row's flags (`record`) or its inline `saved`, and a death the fall dealt files and pays nothing
 * (HS3). `brain` is the encounter's, once installed: a claim marks its record taken. The room's earners keep a fixed step
 * named after the row, so a kill and its victory may straddle a save; the step also says the body's strikes to the page. The row's profile and stages are the keeper's and
 * are not run here.
 */
export function declaredOwnerHooks(host: SimHost, input: unknown, body: AnimalSim, ports: BossOwnerPorts, brain: () => BossBrain | undefined): DeclaredOwnerHooks {
  const row = parseBossOwnerRow(input);
  if (body.entityId !== row.actor) throw new Error('Owner row and declared encounter name different bodies');
  const record = row.record === undefined ? undefined : bossFlagRecord(host.flags, row.record);
  const saved = record?.saved ?? row.saved ?? { defeated: false, rewardTaken: false, kills: 0 };
  const persist = record?.persist ?? (() => undefined);
  const bounty = new BossBounty(host, () => body, row.step);
  const marks = row.profile.pattern === 'spawned' ? row.profile.fight : null;
  // OF20c: its strikes are said as the keeper's borrowed decisions say them (`boss.strike.<id>`), so a page's lane sheet draws them
  host.onStep(row.step, dt => {
    // OF19c1: a spawned profile's marks follow the declared fight as the keeper's fresh body wore them (`bodyBossFight`): the
    // rise counts up through the intro, the fight mark stands through fight and beat, the phase mark is the fight's phase.
    // Her clips and the page read them from her memory (pose inputs); the body's own snapshot keeps them.
    const boss = brain();
    if (marks !== null && boss !== undefined) {
      const state = boss.state, fighting = state === 'fight' || state === 'beat', mem = body.mem, f = marks.fields;
      mem[f.rise] = fighting ? 1 : state === 'intro' ? Math.min(1, (mem[f.rise] ?? 0) + dt / marks.riseSeconds) : 0;
      mem[f.fight] = fighting ? 1 : 0;
      mem[f.phase] = boss.engaged ? boss.phase : boss.checkpoint;
    }
    const runner = host.strikes.get(row.actor), spec = runner?.spec;
    if (runner !== undefined && spec !== null && spec !== undefined) sayFightView(host, `${BOSS_STRIKE}${spec.id}`, [runner.through, runner.yaw, body.position.x, body.position.z]);
  }, { snapshot: () => JSON.stringify(bounty.earned),
    restore: value => { if (typeof value !== 'string') throw new Error(`Invalid ${row.step} continuation`); bounty.restore(v.parse(v.array(v.string()), JSON.parse(value))); } });
  const pay = (): void => {
    const { amount } = row.reward;
    if (bounty.room) bounty.pay(amount, player => { ports.coins(amount, player); }, row.actor); else ports.coins(amount, row.actor);
  };
  let fell = false, unearned = false;
  const actor = body.combatActor(), base = actor.applyDamage;
  actor.applyDamage = req => { const killed = base(req); if (killed) fell = req.sourceTags.includes('env.fall'); return killed; };
  host.scope.onDispose(() => { actor.applyDamage = base; });
  const victory = (): void => {
    unearned = fell; fell = false;
    if (unearned || (row.victory.once && host.flags.has(row.victory.flag))) return;
    host.flags.set(row.victory.flag); ports.fact(row.victory.fact, row.actor);
    if (row.reward.when === 'victory') pay();
  };
  const reward = (): void => {
    if (unearned || row.reward.when !== 'claim' || brain()?.takeReward() !== true) return;
    pay();
  };
  return { saved, persist, reward, victory };
}

/** OF30: a runtime plan's keeper programme, empty when its creatures are all declared rows (no species, no strikes). */
export function keeperProgram(rows: Pick<NativePopulationRows, 'program'>): SpeciesProgramRows {
  return rows.program ?? { species: [], strikes: [] };
}

/** Serializable native population policy (a runtime plan's `population.rows`): since FORMAT-PRUNE FP53b its keeper
 * stands no body; the rows still name the bodies' cadence and the retired step a live save may carry. */
export interface NativePopulationRows {
  /** ONE-FORMAT OF30: the keeper's own species programme; a plan whose creatures are all declared names none. */
  readonly program?: SpeciesProgramRows;
  /** FORMAT-PRUNE FP53b: the retired keeper step's id; a live save's continuation under it restores without it. */
  readonly step: string; readonly seed: number;
  /** FORMAT-PRUNE FP53b: retired, always empty (a runtime plan refuses a keeper home or boss). */
  readonly homes: readonly RetiredKeeperBody[];
  readonly boss?: RetiredKeeperBody;
  readonly attackers: number | null;
  /** The bodies' cadence: `legacy` or `{ bands }` opts the host into body bands; `{ every, dt }` steps plainly. */
  readonly think: { readonly every: number; readonly dt: number } | { readonly bands: SimBodyBands } | 'legacy';
  readonly killY?: number;
  readonly placement?: { readonly fallback: number; readonly rows: readonly unknown[] };
  readonly holds?: readonly { readonly home: number; readonly field: string; readonly until: string }[];
  readonly admission: 'prepare' | 'install';
}
/** A keeper body's row, kept so the retired shape still parses: its id and kind are what a refusal names. */
export interface RetiredKeeperBody { readonly id: string; readonly kind: string; readonly at: readonly [number, number]; readonly yaw: number }
