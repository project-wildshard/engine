import * as v from 'valibot';
import { Vector3 } from 'three';
import { parseBossOwnerRow } from '@wildshard/format/bossProfiles';
import { bossFight } from '../plugin/bossPhase';
import type { HeldBossBrain } from '../../../shared/game/plugin/bodyBoss';
import type { KeptBossBody } from './homeKeeper';
import { DirectorBossBrain } from '../../../shared/game/plugin/director';
import { bossFlagRecord, type BossRecordRow } from '../../../shared/game/plugin/bossRecord';
import { BossBrain, type BossContinuation, type BossDefinition, type BossSaved, type BossScript } from '@wildshard/engine/ai/BossBrain';
import { silentBossPresentation } from '@wildshard/engine/ai/phases';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { installSpeciesHomes, admitSpeciesProgram, bakedSpecs, type SpeciesHomesSpec, type SpeciesProgramRows, type SpeciesDecisionAuthority } from '../plugin/brain';
import { BossContenders } from '@wildshard/engine/ai/bossContenders';
import { BossBounty } from '../boss/bounty';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { NO_MOMENTS, publishEncounter, type EncounterReward } from '@wildshard/engine/sim/encounterRows';

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
  const party = new BossContenders(host.players, point => spec.script.inArena(point), (player, position, yaw) => { player.position.copy(position); player.yaw = yaw; spec.returned?.(player); });
  const bounty = new BossBounty(host, spec.body, spec.step);
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
    party.observe(boss);
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


/** Real roster ownership; the row cannot manufacture, retire or replace a foreign body. */
export type BossOwnerBody =
  | { readonly kind: 'spawned'; readonly keeper: KeptBossBody }
  | { readonly kind: 'held'; readonly actor: AnimalSim; readonly brain: HeldBossBrain };
/** Native effect ports are supplied by the host, never serialized callbacks. */
export interface BossOwnerPorts {
  readonly body: BossOwnerBody;
  readonly fact: (name: string, actorId: string) => void;
  readonly coins: (amount: number, actorId: string) => void;
}
const spawnedState = v.strictObject({ stormGoal: finite, storm: finite, invulnerable: v.boolean() });
/** Install the authored stage/profile and its real body's native lifetime together.
 * Both held and spawned patterns preserve install order, reward timing and the
 * existing BossBrain/fight continuation; restore only adopts the owned roster. */
export function installBossOwnerRow(host: SimHost, input: unknown, ports: BossOwnerPorts): ReturnType<typeof installBossRow> {
  const row = parseBossOwnerRow(input), profile = row.profile, owner = ports.body, installed: { bounty: BossBounty | null } = { bounty: null };
  if (profile.pattern !== owner.kind) throw new Error('Boss owner/profile mismatch');
  /** J105: in a room each earner has the row's coins; alone the row pays as it always has. */
  const pay = (): void => {
    const { bounty } = installed, { amount } = row.reward;
    if (bounty?.room === true) bounty.pay(amount, player => { ports.coins(amount, player); }, row.actor); else ports.coins(amount, row.actor);
  };
  const adopt = (encounter: ReturnType<typeof installBossRow>): ReturnType<typeof installBossRow> => { installed.bounty = encounter.bounty; return encounter; };
  const record = row.record === undefined ? undefined : bossFlagRecord(host.flags, row.record);
  const saved = record?.saved ?? row.saved ?? { defeated: false, rewardTaken: false, kills: 0 };
  const persist = record?.persist ?? (() => undefined);
  const victory = (): void => {
    if (row.victory.once && host.flags.has(row.victory.flag)) return;
    host.flags.set(row.victory.flag); ports.fact(row.victory.fact, row.actor);
    if (row.reward.when === 'victory') pay();
  };
  const reward = row.reward.when === 'claim' ? () => {
    saved.rewardTaken = true; persist(saved); pay();
  } : undefined;
  if (profile.pattern === 'spawned' && owner.kind === 'spawned') {
    const placement = row.placement;
    if (placement === undefined) throw new Error('Spawned boss placement missing');
    const at = placement.rewardPoint, back = placement.respawn, keeper = owner.keeper;
    const fight = bossFight(profile, { body: { spawn: () => keeper.draw(), retire: () => { keeper.free(); } },
      rewardPoint: new Vector3(at.x, at.y, at.z),
      respawnPoint: () => ({ pos: new Vector3(back.x, host.groundHeightAt(back.x, back.z), back.z), yaw: back.yaw }), victory });
    fight.adopt(keeper.actor());
    return adopt(installBossRow(host, { step: row.step, stages: row.stages, definition: row.definition,
      script: fight.script, body: fight.body, shielded: fight.invulnerable,
      fight: { snapshot: fight.snapshot, restore: value => { fight.restore(v.parse(spawnedState, value)); } },
      saved, persist, ...(reward === undefined ? {} : { spawnReward: reward }), armed: row.armed,
      restored: () => { fight.adopt(keeper.actor()); } }));
  }
  if (profile.pattern !== 'held' || owner.kind !== 'held') throw new Error('Held boss owner missing');
  const fight = bossFight(profile, { body: owner.actor, brain: owner.brain, victory });
  return adopt(installBossRow(host, { step: row.step, stages: row.stages, definition: row.definition,
    script: fight.script, body: () => owner.actor, shielded: fight.shielded,
    fight: { snapshot: fight.snapshot, restore: fight.restore }, saved, persist,
    ...(reward === undefined ? {} : { spawnReward: reward }), armed: row.armed }));
}

/** Install an encounter over its declared population's actual owner. Admission
 * checks the owner address before allocating bodies; held controllers come from
 * that population's admitted brain, and spawned bosses use its own keeper.
 * The caller retains construction phase, fixed-step order and settle timing. */
export function installSpeciesEncounter(host: SimHost, population: SpeciesHomesSpec, input: unknown,
  ports: Omit<BossOwnerPorts, 'body'>, saved?: Parameters<typeof installSpeciesHomes>[2]): {
  keeper: ReturnType<typeof installSpeciesHomes>; encounter: ReturnType<typeof installBossOwnerRow>;
} {
  const row = parseBossOwnerRow(input), pattern = row.profile.pattern;
  if (pattern === 'spawned' ? population.boss?.id !== row.actor : !population.homes.some(home => home.id === row.actor)) {
    throw new Error('Encounter owner must belong to its declared species population');
  }
  const keeper = installSpeciesHomes(host, population, saved);
  let body: BossOwnerBody;
  if (pattern === 'spawned') {
    if (keeper.boss === null) throw new Error('Declared spawned encounter has no keeper');
    body = { kind: 'spawned', keeper: keeper.boss };
  } else {
    const actor = keeper.homes().find(home => home.id === row.actor)?.actor;
    const brain = actor === null || actor === undefined ? null : population.brains.held(actor.kind, actor);
    if (actor === null || actor === undefined || brain === null) throw new Error('Declared held encounter has no owned controller');
    body = { kind: 'held', actor, brain };
  }
  return { keeper, encounter: installBossOwnerRow(host, row, { body, ...ports }) };
}

/** Serializable native population policy. Ground-only deferred homes resolve
 * against the actual baked flight recipe, preserving original roster order. */
export interface NativePopulationRows {
  readonly program: SpeciesProgramRows;
  readonly step: string; readonly seed: number;
  readonly homes: readonly (Omit<SpeciesHomesSpec['homes'][number], 'late'> & { readonly late?: boolean | 'ground' })[];
  readonly boss?: SpeciesHomesSpec['boss'];
  readonly attackers: number | null;
  readonly think: SpeciesHomesSpec['think'] | 'legacy';
  readonly killY?: number;
  readonly placement?: SpeciesHomesSpec['placement'];
  readonly holds?: SpeciesHomesSpec['holds'];
  /** Original admission lifetime: per preparation or per host installation. */
  readonly admission: 'prepare' | 'install';
}
/** Prepare original baked recipes and install the existing population/encounter
 * in the caller's phase. No actor, RNG draw or step runs during preparation. */
export function prepareNativePopulation(rows: NativePopulationRows, baked: Parameters<typeof bakedSpecs>[0], owner: unknown): {
  readonly specs: ReturnType<typeof bakedSpecs>;
  readonly install: (host: SimHost, ports: Omit<BossOwnerPorts, 'body'>, saved?: Parameters<typeof installSpeciesHomes>[2], decisions?: SpeciesDecisionAuthority) => ReturnType<typeof installSpeciesEncounter>;
} {
  const specs = bakedSpecs(baked), brains = rows.admission === 'prepare' ? admitSpeciesProgram(rows.program) : null;
  const homes = rows.homes.map(row => ({ ...row, late: row.late === 'ground' ? specs.get(row.kind)?.flight === undefined : row.late ?? false }));
  return { specs, install: (host, ports, saved, decisions) => installSpeciesEncounter(host, {
    ...(decisions === undefined ? {} : { decisions }),
    step: rows.step, seed: rows.seed, homes, specs, species: rows.program.species, brains: brains ?? admitSpeciesProgram(rows.program),
    attackers: rows.attackers ?? Infinity, think: rows.think === 'legacy' ? { bands: { rate: () => 'legacy' } } : rows.think,
    ...(rows.boss === undefined ? {} : { boss: rows.boss }), ...(rows.killY === undefined ? {} : { killY: rows.killY }),
    ...(rows.placement === undefined ? {} : { placement: rows.placement }), ...(rows.holds === undefined ? {} : { holds: rows.holds }),
  }, owner, ports, saved) };
}
