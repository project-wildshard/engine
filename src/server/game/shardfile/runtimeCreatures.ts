// ONE-FORMAT OF19b0: a native runtime plan runs declared creature rows. A shard moving off its species program (Dunes,
// Sky Reach) keeps its runtime plan for its quest page and held melee (J367 (7)), so its creatures become declared spawns
// beside it: the level stands them as an ordinary upload's level does, and the same declared creature host drives them.
// The plan's keeper keeps only its boss (until OF19c), and every `sim/scripts` decision row has one owner: the keeper's
// borrowed authority runs the rows its program's decision brains name, the declared host's `ShardDecisions` the rest.
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost, SimSpawn } from '@wildshard/engine/sim';
import { buildPlatformSpawns } from '@wildshard/engine/ai/platform';
import { decisionScriptsFromSections } from '@wildshard/format/scriptContract';
import { installDataCreatureBands } from './dataCreatureBands';
import { bindCreatureSenses, installCreatureSensesContract } from './creatureSenses';
import { installCreatureVolumes } from './creatureVolumes';
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
import { installDeclaredAttackable } from './declaredAttackable';
import { installDeclaredPatrols } from './declaredPatrols';
import { installDeclaredRanks, rankCreatureSpawns } from './declaredRanks';
import { countSlots } from './declaredSpawnCount';
import { decisionRuntime, ShardDecisions } from './decisions';
import type { NativePopulationRows } from './bossRow';

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
  return { actors: new Set(bodies.map(body => body.id)), scripts: new Set(rows.program.species.flatMap(row =>
    kinds.has(row.kind) && row.brain?.archetype === 'decision' ? [row.brain.data.script] : [])) };
}

/** Refuse, before a body stands, a declared row the keeper also owns or one the declared host cannot run beside a plan. */
export function admitRuntimeCreatures(shard: Shardfile, sections: ReadonlyMap<string, unknown>, keeper: ReturnType<typeof keeperOwnership>): void {
  if (shard.creatures.spawns.length === 0) return;
  const shared = shard.creatures.spawns.filter(row => keeper.actors.has(row.id)).map(row => row.id);
  if (shared.length > 0) throw new Error(`A declared spawn and the runtime plan's keeper both own ${shared.join(', ')}: one body, one owner`);
  const declared = new Set(shard.creatures.spawns.map(row => row.id));
  for (const row of decisionScriptsFromSections(sections)) if (keeper.scripts.has(row.id) && Object.values(row.actors).some(id => declared.has(id)))
    throw new Error(`Decision ${row.id} is the keeper's and binds a declared spawn: one decision row, one owner`);
  if (shard.crowds.length > 0) throw new Error('Declared crowds do not run beside a native runtime plan');
  if (shard.encounters.length > 0) throw new Error('Declared encounters do not run beside a native runtime plan until its boss moves (OF19c)');
  const custom = new Set(shard.creatures.brains.filter(brain => brain.kind === 'script').map(brain => brain.id));
  if (shard.creatures.spawns.some(spawn => spawn.brain !== null && custom.has(spawn.brain))) throw new Error('Declared script brains do not run beside a native runtime plan');
}

export interface RuntimeCreaturePorts {
  readonly restoring: boolean;
  /** What the plan's keeper owns (`keeperOwnership`); a declared row never shares a body or a decision row with it. */
  readonly keeper: ReturnType<typeof keeperOwnership>;
  /** The runtime's ledger fact port, for a decision's grant. */
  readonly fact: (name: string, actorId: string) => void;
}

/**
 * Install the declared creature host on a native runtime's host, as `bindShardfileSim` installs it for an ordinary upload:
 * senses, volumes, bands, the data host's herd, diver, ground and perch brains, groups, spawn-when rows, respawns, layer
 * hunts, patrols, ranks and attackable rows, and the decision rows bound to declared spawns. A shard with no declared
 * spawn installs nothing, so a runtime saved before OF19b0 restores unchanged. `shard` is counted (`countedShard`).
 * Script brains, crowds and declared encounters stay on the ordinary upload until their rows move (OF19c).
 */
export function installRuntimeCreatures(host: SimHost, shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>,
  sections: ReadonlyMap<string, unknown>, ports: RuntimeCreaturePorts): void {
  if (shard.creatures.spawns.length === 0) return;
  admitRuntimeCreatures(shard, sections, ports.keeper);
  const scripts = decisionScriptsFromSections(sections);
  nameDeclaredBodies(host, shard);
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
  installDeclaredBrains(host, creatures.spawns.filter(spawn => spawn.brain === null || !groupIds.has(spawn.brain)),
    creatures.brains.filter(brain => brain.kind !== 'script'), brains, resolveCreatureLayers(shard.rows, creatures.brains));
  installDeclaredSpawnWhen(host, creatures.spawns, ports.restoring, countSlots(shard));
  installDataRespawns(host, creatures.spawns);
  installLayerHunts(host, shard.rows, creatures);
  data.install();
  // One owner per decision row: the keeper's rows stay with its borrowed authority, every other row is the declared host's
  const owned = scripts.filter(row => !ports.keeper.scripts.has(row.id));
  if (owned.length > 0) new ShardDecisions(decisionRuntime(host), shard, assets, new Map([...sections, ['sim/scripts', owned]]), new Map(), undefined,
    undefined, ports.fact, ports.restoring);
  groups.install(ports.restoring);
  installDeclaredAttackable(host, shard);
  installDeclaredPatrols(host, creatures.patrols ?? [], ports.restoring);
  installDeclaredRanks(host, shard.creatures.spawns);
}
