// ONE-FORMAT OF19b0: a native runtime plan runs declared creature rows. A shard moving off its species program (Dunes,
// Sky Reach) keeps its runtime plan for its quest page and held melee (J367 (7)), so its creatures become declared spawns
// beside it: the level stands them as an ordinary upload's level does, and the same declared creature host drives them.
// The plan's keeper keeps only its boss, or nothing once its boss is a declared encounter (OF19c0), and every
// `sim/scripts` decision row has one owner: the keeper's borrowed authority runs the rows its program's decision brains
// name, the declared host's `ShardDecisions` the rest.
import type { Shardfile } from '@wildshard/format/shardSchema';
import { parseBossOwnerRow } from '@wildshard/format/bossProfiles';
import type { SimHost, SimSpawn } from '@wildshard/engine/sim';
import { buildPlatformSpawns } from '@wildshard/engine/ai/platform';
import { decisionScriptsFromSections } from '@wildshard/format/scriptContract';
import { installDataCreatureBands } from './dataCreatureBands';
import { bindCreatureSenses, installCreatureSensesContract } from './creatureSenses';
import { installCreatureVolumes } from './creatureVolumes';
import { declaredFightOwns } from './declaredHerds';
import { sizeCreatureSpawns } from './creatureSizes';
import { dataPerchBrains, preflightPlainPerches } from './dataPerchBrains';
import { dataCreaturePorts } from '../../../shared/game/shardfile/dataCreaturePorts';
import { speciesResolver, simStrikes } from '../plugin/brain';
import { prepareCreaturePolicies, resolveCreatureLayers } from './creatureLayers';
import { installLayerHunts } from './layerHunts';
import { installDeclaredBrains } from './brainRuntime';
import { dataGroundBrains } from './dataGroundBrains';
import { installDataRespawns } from './dataRespawn';
import { prepareDeclaredGroupBrains } from './groupRuntime';
import { installDeclaredSpawnWhen } from './declaredSpawnWhen';
import { installDeclaredHolds } from './declaredHolds';
import { installDeclaredAttackable } from './declaredAttackable';
import { installDeclaredPatrols } from './declaredPatrols';
import { installDeclaredRanks, rankCreatureSpawns } from './declaredRanks';
import { countSlots } from './declaredSpawnCount';
import { decisionRuntime, ShardDecisions } from './decisions';
import { installDeclaredEncounters } from '../shard/declaredEncounters';
import { installEncounterAdds } from './encounterAdds';
import { declaredOwnerHooks, keeperProgram, type NativePopulationRows } from './bossRow';
import type { PhaseEncounter } from '@wildshard/engine/ai/phases';
import { creatureFloor } from './homeKeeper';
import { killBelowWorld } from '@wildshard/engine/entities/killHeight';

/** The declared spawns as a level stands them: platform bodies, sized by their species, ranked. `shard` is counted. */
export function declaredSpawnEntities(shard: Shardfile): SimSpawn[] {
  const spawns = shard.creatures.spawns;
  return rankCreatureSpawns(sizeCreatureSpawns(buildPlatformSpawns(spawns, speciesResolver(shard.rows, shard.creatures.brains), simStrikes(shard.rows)), shard.rows, spawns), spawns);
}

/** TE-ENG7: each declared body names its species, harvest, cap and rank, on create and on restore alike (never in the
 *  level's spec, so a save keeps its level fingerprint). `shard` is counted. */
export function nameDeclaredBodies(host: SimHost, shard: Shardfile): void {
  for (const spawn of shard.creatures.spawns) {
    const body = host.entities.get(spawn.id);
    if (body === undefined) continue;
    const species = shard.rows.species.find(row => row.id === spawn.species);
    body.species = spawn.species;
    body.harvest = species?.harvest ?? [];
    body.capExempt = species?.capExempt;
    body.rank = spawn.rank; // OF33b: its loot rolls and blows read it
  }
}

/** The bodies and decision rows a runtime plan's keeper owns: its homes, its boss, and the rows named by the decision
 *  brains of the kinds it stands (a program species the keeper stands no body of owns no row). */
export function keeperOwnership(rows: Pick<NativePopulationRows, 'program' | 'homes' | 'boss'>): { actors: ReadonlySet<string>; scripts: ReadonlySet<string> } {
  const bodies = [...rows.homes, ...rows.boss === undefined ? [] : [rows.boss]], kinds = new Set(bodies.map(body => body.kind));
  return { actors: new Set(bodies.map(body => body.id)), scripts: new Set(keeperProgram(rows).species.flatMap(row =>
    kinds.has(row.kind) && row.brain?.archetype === 'decision' ? [row.brain.data.script] : [])) };
}

/** Refuse, before a body stands, a declared row the keeper also owns or one the declared host cannot run beside a plan. */
export function admitRuntimeCreatures(shard: Shardfile, sections: ReadonlyMap<string, unknown>, keeper: ReturnType<typeof keeperOwnership>): void {
  if (shard.creatures.spawns.length === 0) return;
  const shared = shard.creatures.spawns.filter(row => keeper.actors.has(row.id)).map(row => row.id);
  if (shared.length > 0) throw new Error(`A declared spawn and the runtime plan's keeper both own ${shared.join(', ')}: one body, one owner`);
  // OF23d: a keeper's row may bind a declared spawn with no brain of its own: the keeper lends it that body (a boss fight's)
  const declared = new Set(shard.creatures.spawns.filter(row => row.brain !== null).map(row => row.id));
  for (const row of decisionScriptsFromSections(sections)) if (keeper.scripts.has(row.id) && Object.values(row.actors).some(id => declared.has(id)))
    throw new Error(`Decision ${row.id} is the keeper's and binds a declared spawn: one decision row, one owner`);
  if (shard.crowds.length > 0) throw new Error('Declared crowds do not run beside a native runtime plan');
  const custom = new Set(shard.creatures.brains.filter(brain => brain.kind === 'script').map(brain => brain.id));
  if (shard.creatures.spawns.some(spawn => spawn.brain !== null && custom.has(spawn.brain))) throw new Error('Declared script brains do not run beside a native runtime plan');
}

/** OF20c / OF19c1: the actor of a runtime plan's owner row when it names a declared spawn the keeper does not stand, whose
 *  declared boss encounter then takes the row; undefined when the row is the keeper's or the plan keeps none. A row on a
 *  declared spawn with no boss encounter refuses. */
export function declaredOwner(shard: Pick<Shardfile, 'creatures' | 'encounters'>, owner: unknown, keeper: ReturnType<typeof keeperOwnership>): string | undefined {
  if (owner === undefined) return undefined;
  const actor = parseBossOwnerRow(owner).actor;
  if (keeper.actors.has(actor) || !shard.creatures.spawns.some(row => row.id === actor)) return undefined;
  if (!shard.encounters.some(row => row.entity === actor && row.kind === 'boss')) throw new Error(`The runtime plan's owner row names declared spawn ${actor}, which has no boss encounter`);
  return actor;
}

export interface RuntimeCreaturePorts {
  readonly restoring: boolean;
  /** What the plan's keeper owns (`keeperOwnership`); a declared row never shares a body or a decision row with it. */
  readonly keeper: ReturnType<typeof keeperOwnership>;
  /** The runtime's ledger fact port, for a decision's grant. */
  readonly fact: (name: string, actorId: string) => void;
  /** OF19c0: the spawns the quest page summons (`{ spawn }`): their encounters wait, dormant, for `summon`. */
  readonly summoned: ReadonlySet<string>;
  /** OF20b: the plan's world as its keeper's bodies meet it. `floor`: a plan that stands creatures on its solids (Sky
   *  Reach's isles, `floor: 'solids'`) stands declared bodies there too, over `fallback` where none is below; `killY`:
   *  a declared body under the plan's death plane dies by the fall, as a keeper home does. */
  readonly world?: { readonly floor?: { readonly fallback: number }; readonly killY?: number };
  /** OF20c / OF19c1: the plan's owner row when it names a declared encounter's spawn (`declaredOwner`): that encounter
   *  files its victory, pays its reward and keeps its record (`declaredOwnerHooks`), paid through `coins`. */
  readonly owner?: { readonly row: unknown; readonly actor: string; readonly coins: (amount: number, actorId: string) => void };
}
export const DECLARED_KILL_STEP = 'runtime.declared-kill';

/** OF20b: a declared body beside a runtime plan stands on the plan's solids and dies under its death plane, as the
 *  keeper's homes did (retired by FORMAT-PRUNE FP53b). Nothing when the plan declares neither. */
function installDeclaredWorld(host: SimHost, shard: Shardfile, world: RuntimeCreaturePorts['world']): void {
  const bodies = shard.creatures.spawns.map(row => row.id);
  if (world?.floor !== undefined) {
    const floor = creatureFloor(host, () => world.floor?.fallback ?? 0);
    for (const id of bodies) {
      const actor = host.entities.get(id); if (actor === undefined) continue;
      actor.groundHeight = (x, z, fromY) => { const at = floor(x, z, fromY); actor.levelGround = at.structure; return at.y; };
    }
  }
  const killY = world?.killY;
  if (killY === undefined) return;
  const plane = { killY };
  // A declared boss is fought, never felled by the world: its flight follows a player down, and the plane would pay it out
  // unstruck. Under the plane it goes back to its spawn, alive, as a keeper's held boss goes back to its anchor (HS3).
  const bosses = new Map(shard.creatures.spawns.filter(row => shard.encounters.some(entry => entry.kind === 'boss' && entry.entity === row.id)).map(row => [row.id, row]));
  host.onStep(DECLARED_KILL_STEP, () => {
    for (const id of bodies) {
      const actor = host.entities.get(id); if (actor?.alive !== true) continue;
      const boss = bosses.get(id);
      if (boss === undefined) killBelowWorld(actor, plane, host.combat);
      else if (actor.position.y < killY) actor.place(boss.at[0], boss.at[2], boss.yaw, boss.at[1]);
    }
  });
}
/** A declared encounter beside a runtime plan, as the quest page's summon and the plan's loadout lock read it. */
export interface RuntimeEncounter { readonly summon: () => void; readonly locked: () => boolean }

/**
 * Install the declared creature host on a native runtime's host, as `bindShardfileSim` installs it for an ordinary upload:
 * senses, volumes, bands, the data host's herd, diver, ground and perch brains, groups, spawn-when rows, respawns, layer
 * hunts, patrols, ranks and attackable rows, and the decision rows bound to declared spawns. A shard with no declared
 * spawn installs nothing, so a runtime saved before OF19b0 restores unchanged. `shard` is counted (`countedShard`).
 * OF19c0: declared encounters install as there too (phase adds, decision encounters); each answers the quest page's
 * summon by its spawn's id. Script brains and crowds stay on the ordinary upload.
 */
export function installRuntimeCreatures(host: SimHost, shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>,
  sections: ReadonlyMap<string, unknown>, ports: RuntimeCreaturePorts): ReadonlyMap<string, RuntimeEncounter> {
  if (shard.creatures.spawns.length === 0) return new Map();
  admitRuntimeCreatures(shard, sections, ports.keeper);
  const scripts = decisionScriptsFromSections(sections);
  nameDeclaredBodies(host, shard);
  installDeclaredWorld(host, shard, ports.world);
  preflightPlainPerches(shard, assets);
  const creatures = prepareCreaturePolicies(shard.rows, shard.creatures);
  installCreatureSensesContract(host, shard.rows, creatures.spawns);
  installCreatureVolumes(host, shard, assets);
  installDataCreatureBands(host, shard.rows, creatures);
  const species = new Map(shard.rows.species.map(row => [row.id, row])), spawns = new Map(creatures.spawns.map(row => [row.id, row]));
  const data = dataCreaturePorts(host, shard.rows, creatures.spawns, undefined, actor => {
    const spawn = spawns.get(actor.entityId), input = spawn === undefined ? undefined : species.get(spawn.species)?.senses;
    return input === undefined ? undefined : bindCreatureSenses(host, actor, input).nearest;
  });
  const brains = { ...data.brains, ...dataGroundBrains(host, shard.rows, creatures.spawns), ...dataPerchBrains(host, shard, assets) };
  const groupIds = new Set(creatures.groups.map(group => group.id));
  const groups = prepareDeclaredGroupBrains(host, creatures.groups, creatures.spawns, data.groups, creatures.brains.map(brain => brain.id), []);
  installDeclaredHolds(host, creatures.spawns);
  installDeclaredBrains(host, creatures.spawns.filter(spawn => spawn.brain === null || !groupIds.has(spawn.brain)),
    creatures.brains.filter(brain => brain.kind !== 'script'), brains, resolveCreatureLayers(shard.rows, creatures.brains));
  installDeclaredSpawnWhen(host, creatures.spawns, ports.restoring, countSlots(shard));
  installDataRespawns(host, creatures.spawns);
  installLayerHunts(host, shard.rows, creatures, shard.manifest?.fight);
  data.install();
  // One owner per decision row: the keeper's rows stay with its borrowed authority, every other row is the declared host's
  const owned = scripts.filter(row => !ports.keeper.scripts.has(row.id));
  // OF19c0: declared encounters as `bindShardfileSim` installs them; one the quest page summons waits for its summon
  const actors = new Set(owned.flatMap(row => Object.values(row.actors)));
  // OF20c: the encounter the plan's owner row names takes its hooks; every other one keeps no record and pays nothing
  const fights: { value?: ReadonlyMap<string, PhaseEncounter> } = {};
  const hooks = (id: string) => {
    const row = shard.encounters.find(entry => entry.id === id), owner = ports.owner, body = row === undefined ? undefined : host.entities.get(row.entity);
    if (owner === undefined || row?.entity !== owner.actor || body === undefined) return { saved: { defeated: false, rewardTaken: false, kills: 0 }, persist: () => undefined, reward: () => undefined };
    return declaredOwnerHooks(host, owner.row, body, { fact: ports.fact, coins: owner.coins }, () => fights.value?.get(id)?.boss);
  };
  // OF23d: a `boss` row on a body a native fight owns declares that boss; the native fight runs him, so no PhaseEncounter
  const rows = shard.encounters.filter(row => !(row.kind === 'boss' && declaredFightOwns(host, row.entity)));
  const encounters = installDeclaredEncounters(host, rows, id => ({ ...hooks(id), summoned: rows.some(row => row.id === id && ports.summoned.has(row.entity)) }), undefined,
  new Set(rows.filter(row => actors.has(row.entity)).map(row => row.id)));
  fights.value = encounters;
  const adds = installEncounterAdds(host, rows, creatures.spawns, encounters, ports.restoring);
  if (owned.length > 0) new ShardDecisions(decisionRuntime(host, undefined, adds ?? undefined), shard, assets, new Map([...sections, ['sim/scripts', owned]]), encounters, undefined,
    undefined, ports.fact, ports.restoring);
  groups.install(ports.restoring);
  installDeclaredAttackable(host, shard);
  installDeclaredPatrols(host, creatures.patrols ?? [], ports.restoring);
  installDeclaredRanks(host, shard.creatures.spawns);
  return new Map(rows.flatMap(row => {
    const encounter = encounters.get(row.id);
    return encounter === undefined ? [] : [[row.entity, { summon: () => { encounter.summon(); }, locked: () => encounter.boss.state === 'intro' }] as const];
  }));
}
