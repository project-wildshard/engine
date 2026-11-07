import { preparePlatformBrains, type PlatformBrainSpec, type PlatformSpawn, type BrainNavigation } from '@wildshard/engine/ai/platform';
import { SkirmisherBrain, type SkirmisherPorts } from '@wildshard/engine/ai/skirmisher';
import { GuardianBrain, type GuardianPorts } from '@wildshard/engine/ai/guardian';
import { PerchHunterBrain, type PerchHunterPorts } from '@wildshard/engine/ai/perchHunter';
import { RamGrazerBrain, type RamGrazerPorts } from '@wildshard/engine/ai/ramGrazer';
import { ChallengeGrazerBrain, type ChallengeGrazerPorts } from '@wildshard/engine/ai/challengeGrazer';
import { OrbitDiverBrain, type OrbitDiverPorts } from '@wildshard/engine/ai/orbitDiver';
import { PatrolDiverBrain, type PatrolDiverPorts } from '@wildshard/engine/ai/patrolDiver';
import { BurstFlyerBrain, type BurstFlyerPorts } from '@wildshard/engine/ai/burstFlyer';
import * as v from 'valibot';
import { CreatureHomeSchema, type ShardCreatureHome } from '@wildshard/format/creatures';
import type { StrikeSpec } from '@wildshard/engine/ai/strikes';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost, SimStateAdapter } from '@wildshard/engine/sim';
import { parseStalker, stalkerPreset, type ShardStalker, parseGuardianPattern, guardianPreset, type ShardGuardianPattern, parseSkirmisher, parseGuardian, parsePerchHunter, type ShardSkirmisher, type ShardGuardian, type ShardPerchHunter } from '@wildshard/format/brains';
import { parseRamGrazer, parseChallengeGrazer, parseGrazer, grazerPreset, type ShardGrazer, type ShardRamGrazer, type ShardChallengeGrazer } from '@wildshard/format/grazers';
import { parseDiver, diverPreset, type ShardDiver, parseOrbitDiver, parsePatrolDiver, parseBurstFlyer, type ShardOrbitDiver, type ShardPatrolDiver, type ShardBurstFlyer } from '@wildshard/format/flyers';

/** Native decision families and the existing pursuit family; custom scripts require a composed host. */
export type DeclaredNativeBrain = ShardStalker | ShardGuardianPattern | ShardDiver | ShardGrazer | PlatformBrainSpec | ShardSkirmisher | ShardGuardian | ShardPerchHunter | ShardRamGrazer | ShardChallengeGrazer | ShardOrbitDiver | ShardPatrolDiver | ShardBurstFlyer;
/** One trusted actor's observations and body recipe; construction must not execute gameplay or consume RNG. */
export interface DeclaredBrainRecipe<P> { observe: (dt: number) => P; body: (dt: number) => void }
/** Loader-injected native recipes retain navigation, vertical movement, attack tokens and strike ownership. */
export interface DeclaredBrainPorts {
  navigation?: BrainNavigation;
  skirmisher?: (actor: AnimalSim, host: SimHost) => DeclaredBrainRecipe<SkirmisherPorts<AnimalSim>>;
  guardian?: (actor: AnimalSim, host: SimHost) => DeclaredBrainRecipe<GuardianPorts<AnimalSim>>;
  perchHunter?: (actor: AnimalSim, host: SimHost) => DeclaredBrainRecipe<PerchHunterPorts<AnimalSim>>;
  /** Pure preparation binds the declared strike and native floor/body without executing gameplay. */
  ramGrazer?: (actor: AnimalSim, declaration: ShardRamGrazer, host: SimHost) => DeclaredBrainRecipe<RamGrazerPorts<AnimalSim>> & { strike: StrikeSpec };
  /** Pure preparation binds both named strikes and the stable actor phase; the installer owns their mutable clock. */
  challengeGrazer?: (actor: AnimalSim, declaration: ShardChallengeGrazer, host: SimHost) => DeclaredBrainRecipe<ChallengeGrazerPorts<AnimalSim>> & { charge: StrikeSpec; close: StrikeSpec };
  /** Bind native flight/contact authority to one declared overhead orbit and named strike without executing it. */
  orbitDiver?: (actor: AnimalSim, declaration: ShardOrbitDiver, host: SimHost) => DeclaredBrainRecipe<OrbitDiverPorts<AnimalSim>> & { strike: StrikeSpec };
  /** Bind native flight and contact for the declared player circle, home patrol and held-memory field. */
  patrolDiver?: (actor: AnimalSim, declaration: ShardPatrolDiver, host: SimHost) => DeclaredBrainRecipe<PatrolDiverPorts<AnimalSim>> & { strike: StrikeSpec };
  /** Bind the native flight body and authorized player-shove port; all mutable clocks stay policy-owned. */
  burstFlyer?: (actor: AnimalSim, declaration: ShardBurstFlyer, host: SimHost) => DeclaredBrainRecipe<BurstFlyerPorts<AnimalSim>> & { strike: StrikeSpec };
}
/** Stable spawn identity with optional explicitly authored per-body home authority. */
export type DeclaredBrainSpawn = PlatformSpawn & { home?: ShardCreatureHome | undefined; phaseOffset?: number | undefined };
interface Registration { id: string; run: (dt: number) => void; adapter: SimStateAdapter }
function nativeRegistration<P>(id: string, actor: AnimalSim, divisor: number, brain: SimStateAdapter & { think: (ports: P) => void }, recipe: DeclaredBrainRecipe<P>, host: SimHost): Registration {
  if (typeof recipe.observe !== 'function' || typeof recipe.body !== 'function') throw new Error('Missing native brain recipe');
  const contract = JSON.stringify({ divisor, policy: brain.snapshot() });
  return { id, run: dt => {
    if (!actor.alive) return;
    if (host.state.tick % divisor === 0) brain.think(recipe.observe(divisor / 60));
    recipe.body(dt);
  }, adapter: { snapshot: () => contract, restore: saved => {
    if (saved !== contract) throw new Error('Incompatible native brain continuation');
  } } };
}
function mutableRegistration<P>(id: string, actor: AnimalSim, divisor: number,
  brain: SimStateAdapter & { think: (ports: P) => void; act: (ports: P) => void }, recipe: DeclaredBrainRecipe<P>, host: SimHost, home?: ShardCreatureHome, phaseOffset?: number): Registration {
  const contract = JSON.stringify({ version: 1, divisor, ...(home === undefined ? {} : { home }), ...(phaseOffset === undefined ? {} : { phaseOffset }) });
  return { id, run: dt => {
    if (!actor.alive) return;
    if (host.state.tick % divisor === 0) brain.think(recipe.observe(divisor / 60));
    brain.act(recipe.observe(dt)); recipe.body(dt);
  }, adapter: { snapshot: () => [contract, brain.snapshot()], restore: saved => {
    if (!Array.isArray(saved) || saved.length !== 2 || saved[0] !== contract || saved[1] === undefined) throw new Error('Incompatible native policy cadence continuation');
    brain.restore(saved[1]);
  } } };
}
/** Preflight every actor, declaration and native port before registering any callback; restore installs without running recipes. */
export function installDeclaredBrains(host: SimHost, rows: readonly DeclaredBrainSpawn[], declarations: readonly DeclaredNativeBrain[], ports: DeclaredBrainPorts = {}): ReadonlyMap<string, SimStateAdapter> {
  const presets = declarations.map(row => row.kind === 'stalker' ? stalkerPreset(parseStalker(row)) : row.kind === 'guardian' && 'pattern' in row ? guardianPreset(parseGuardianPattern(row)) : row.kind === 'grazer' ? grazerPreset(parseGrazer(row)) : row.kind === 'diver' ? diverPreset(parseDiver(row)) : row);
  const definitions = new Map(presets.map(row => [row.id, row]));
  if (definitions.size !== declarations.length || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate declared brain identity');
  for (const row of presets) {
    switch (row.kind) {
      case 'pursue': break;
      case 'skirmisher': parseSkirmisher(row); break;
      case 'guardian': parseGuardian(row); break;
      case 'perch-hunter': parsePerchHunter(row); break;
      case 'ram-grazer': parseRamGrazer(row); break;
      case 'challenge-grazer': parseChallengeGrazer(row); break;
      case 'orbit-diver': parseOrbitDiver(row); break;
      case 'patrol-diver': parsePatrolDiver(row); break;
      case 'burst-flyer': parseBurstFlyer(row); break;
      default: throw new Error('Unsupported declared brain family');
    }
  }
  for (const row of rows) {
    if (row.home !== undefined) v.parse(CreatureHomeSchema, row.home);
    if (row.phaseOffset !== undefined && (!Number.isFinite(row.phaseOffset) || Math.abs(row.phaseOffset) > 2 * Math.PI)) throw new Error('Invalid authored circle phase');
    if (row.brain === null) continue;
    const spec = definitions.get(row.brain);
    if (!host.entities.has(row.id) || spec === undefined || host.adapters.has(`brain.${row.id}`)) throw new Error('Unresolved or installed declared brain');
    const actor = host.entities.get(row.id);
    if ((spec.kind === 'orbit-diver' || spec.kind === 'patrol-diver' || spec.kind === 'burst-flyer')
      && actor?.snapshot().flight === null) throw new Error('Missing declared actor flight');
    if ((spec.kind === 'skirmisher' && ports.skirmisher === undefined) || (spec.kind === 'guardian' && ports.guardian === undefined)
      || (spec.kind === 'perch-hunter' && ports.perchHunter === undefined)
      || (spec.kind === 'ram-grazer' && ports.ramGrazer === undefined)
      || (spec.kind === 'challenge-grazer' && ports.challengeGrazer === undefined)
      || (spec.kind === 'orbit-diver' && ports.orbitDiver === undefined)
      || (spec.kind === 'patrol-diver' && ports.patrolDiver === undefined)
      || (spec.kind === 'burst-flyer' && ports.burstFlyer === undefined)) throw new Error('Missing native brain port');
  }
  const pursueRows = rows.filter(row => row.brain !== null && definitions.get(row.brain)?.kind === 'pursue');
  const pursuits = preparePlatformBrains(host, pursueRows, presets.filter(row => row.kind === 'pursue'), ports.navigation);
  const registrations: Registration[] = [];
  for (const row of rows) {
    if (row.brain === null) continue;
    const spec = definitions.get(row.brain), actor = host.entities.get(row.id), pursuit = pursuits.get(row.id), id = `brain.${row.id}`;
    if (spec === undefined || actor === undefined) throw new Error('Unresolved declared actor');
    switch (spec.kind) {
      case 'pursue':
        if (pursuit === undefined) throw new Error('Unresolved pursuit policy');
        registrations.push({ id, run: () => { pursuit.step(host.state.tick); }, adapter: pursuit }); break;
      case 'skirmisher':
        if (ports.skirmisher === undefined) throw new Error('Missing native brain port');
        registrations.push(nativeRegistration(id, actor, spec.thinkDivisor, new SkirmisherBrain(actor, spec), ports.skirmisher(actor, host), host)); break;
      case 'guardian':
        if (ports.guardian === undefined) throw new Error('Missing native brain port');
        registrations.push(nativeRegistration(id, actor, spec.thinkDivisor, new GuardianBrain(actor, spec), ports.guardian(actor, host), host)); break;
      case 'perch-hunter':
        if (ports.perchHunter === undefined) throw new Error('Missing native brain port');
        registrations.push(nativeRegistration(id, actor, spec.thinkDivisor, new PerchHunterBrain(actor, spec), ports.perchHunter(actor, host), host)); break;
      case 'ram-grazer': {
        if (ports.ramGrazer === undefined) throw new Error('Missing native brain port');
        const recipe = ports.ramGrazer(actor, spec, host);
        if (typeof recipe.observe !== 'function' || typeof recipe.body !== 'function' || recipe.strike.id !== spec.strike) throw new Error('Unresolved declared grazer strike or recipe');
        registrations.push(mutableRegistration(id, actor, spec.thinkDivisor, new RamGrazerBrain(actor, spec, recipe.strike), recipe, host, row.home)); break;
      }
      case 'challenge-grazer': {
        if (ports.challengeGrazer === undefined) throw new Error('Missing native brain port');
        const recipe = ports.challengeGrazer(actor, spec, host);
        if (typeof recipe.observe !== 'function' || typeof recipe.body !== 'function' || recipe.charge.id !== spec.charge
          || recipe.close.id !== spec.close) throw new Error('Unresolved declared grazer strikes or recipe');
        registrations.push(mutableRegistration(id, actor, spec.thinkDivisor, new ChallengeGrazerBrain(actor, spec, recipe.charge, recipe.close), recipe, host, row.home, row.phaseOffset)); break;
      }
      case 'orbit-diver': {
        if (ports.orbitDiver === undefined) throw new Error('Missing native brain port');
        const recipe = ports.orbitDiver(actor, spec, host);
        if (typeof recipe.observe !== 'function' || typeof recipe.body !== 'function' || recipe.strike.id !== spec.strike) throw new Error('Unresolved declared flyer strike or recipe');
        registrations.push(mutableRegistration(id, actor, spec.thinkDivisor, new OrbitDiverBrain(actor, spec, row.home ?? spec.home, recipe.strike), recipe, host, row.home)); break;
      }
      case 'patrol-diver': {
        if (ports.patrolDiver === undefined) throw new Error('Missing native brain port');
        const recipe = ports.patrolDiver(actor, spec, host);
        if (typeof recipe.observe !== 'function' || typeof recipe.body !== 'function' || recipe.strike.id !== spec.strike) throw new Error('Unresolved declared flyer strike or recipe');
        registrations.push(mutableRegistration(id, actor, spec.thinkDivisor, new PatrolDiverBrain(actor, spec, row.home ?? spec.home, recipe.strike), recipe, host, row.home)); break;
      }
      case 'burst-flyer': {
        if (ports.burstFlyer === undefined) throw new Error('Missing native brain port');
        const recipe = ports.burstFlyer(actor, spec, host);
        if (typeof recipe.observe !== 'function' || typeof recipe.body !== 'function' || recipe.strike.id !== spec.strike) throw new Error('Unresolved declared flyer strike or recipe');
        registrations.push(mutableRegistration(id, actor, spec.thinkDivisor, new BurstFlyerBrain(actor, spec, row.home ?? spec.home, recipe.strike), recipe, host, row.home)); break;
      }
      default: throw new Error('Unsupported declared brain family');
    }
  }
  const result = new Map<string, SimStateAdapter>();
  const remove: (() => void)[] = [];
  try {
    for (const registration of registrations) { remove.push(host.onStep(registration.id, registration.run, registration.adapter)); result.set(registration.id.slice(6), registration.adapter); }
  } catch (error) { for (const undo of remove) undo(); throw error; }
  return result;
}
