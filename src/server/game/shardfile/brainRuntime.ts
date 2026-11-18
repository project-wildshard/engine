import { preparePlatformBrains, type PlatformBrainSpec, type PlatformSpawn, type BrainNavigation, type BrainTarget } from '@wildshard/engine/ai/platform';
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
import type { SimHost, SimStateAdapter, SimStrike } from '@wildshard/engine/sim';
import type { ResolvedCreatureLayers } from './creatureLayers';
import { bindCreatureTemperament } from './creatureTemperament';
import { bindGroundTemperament } from './groundTemperament';
import { bindCreatureSenses } from './creatureSenses';
import { parseStalker, stalkerPreset, type ShardStalker, parseGuardianPattern, guardianPreset, type ShardGuardianPattern, parseSkirmisher, parseGuardian, parsePerchHunter, type ShardSkirmisher, type ShardGuardian, type ShardPerchHunter } from '@wildshard/format/brains';
import { parseRamGrazer, parseChallengeGrazer, parseGrazer, grazerPreset, type ShardGrazer, type ShardRamGrazer, type ShardChallengeGrazer } from '@wildshard/format/grazers';
import { parseDiver, diverPreset, type ShardDiver, parseOrbitDiver, parsePatrolDiver, parseBurstFlyer, type ShardOrbitDiver, type ShardPatrolDiver, type ShardBurstFlyer } from '@wildshard/format/flyers';

/** Native decision families and the existing pursuit family; custom scripts require a composed host. */
export type DeclaredNativeBrain = ShardStalker | ShardGuardianPattern | ShardDiver | ShardGrazer | PlatformBrainSpec | ShardSkirmisher | ShardGuardian | ShardPerchHunter | ShardRamGrazer | ShardChallengeGrazer | ShardOrbitDiver | ShardPatrolDiver | ShardBurstFlyer;
/** One host-owned actor's observations and body recipe; construction must not execute gameplay or consume RNG. */
export interface DeclaredBrainRecipe<P> {
  observe: (dt: number) => P; body: (dt: number) => void;
  /** Optional admitted acquisition; retained/provoked player identity stays with the existing native owner. */
  nearest?: () => ReturnType<SimHost['nearestPlayer']> | undefined;
  /** Observation and contact must share this actual-player selection; undefined suppresses contact. */
  bindTarget?: (read: () => ReturnType<SimHost['nearestPlayer']> | undefined) => void;
}
/** Loader-injected native recipes retain navigation, vertical movement, attack tokens and strike ownership. */
export interface DeclaredBrainPorts {
  navigation?: BrainNavigation;
  skirmisher?: (actor: AnimalSim, host: SimHost, declaration?: ShardSkirmisher) => DeclaredBrainRecipe<SkirmisherPorts<AnimalSim>>;
  guardian?: (actor: AnimalSim, host: SimHost, declaration?: ShardGuardian) => DeclaredBrainRecipe<GuardianPorts<AnimalSim>>;
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
interface Registration { id: string; run: (dt: number) => void; adapter: SimStateAdapter; install?: () => () => void }
function prepareAbilities(host: SimHost, actor: AnimalSim, abilities: ResolvedCreatureLayers['abilities']) {
  const options = abilities.map(({ ability, strike: { weight: _weight, speed, ...strike } }) => {
    const [min, max] = typeof ability.range === 'number' ? [0, ability.range] : ability.range;
    const spec: SimStrike = {
      ...strike,
      damage: ability.damage ?? strike.damage,
      windup: ability.windup ?? strike.windup,
      active: ability.duration ?? strike.active,
      cooldown: ability.cooldown,
      independentCooldown: true,
      ability: ability.clip === undefined ? {} : { clip: ability.clip },
      motion: { speed: ability.speed ?? speed },
      ...(ability.from === undefined ? {} : { from: ability.from }),
      ...(ability.effect === 'knockback' && ability.strength !== undefined ? { knockbackDistance: ability.strength } : {}),
      ...(ability.projectile === undefined ? {} : { projectile: ability.projectile }),
    };
    return { min, max, ability, spec };
  });
  return {
    install: () => {
      const removePlayback = actor.bindAbilityPlayback(() => host.strikes.get(actor.entityId)?.ability);
      try {
        const removeCatalogue = host.bindStrikeCatalogue(actor.entityId, options.map(row => row.spec));
        return () => { removePlayback(); removeCatalogue(); };
      } catch (error) {
        removePlayback();
        throw error;
      }
    },
    request: (target: BrainTarget): boolean => {
      if (host.strikes.get(actor.entityId)?.busy === true) return true;
      const at = actor.position, distance = Math.hypot(target.position.x - at.x, target.position.z - at.z);
      // CC59: a brain hook's chosen ability replaces the next pick; it waits for its range, and a strike this creature
      // does not have is dropped.
      const next = actor.nextAbility === null ? undefined : options.find(row => row.spec.id === actor.nextAbility);
      if (actor.nextAbility !== null && next === undefined) actor.nextAbility = null;
      if (next !== undefined) {
        if (distance < next.min || distance > next.max) return false;
        if (!host.startDeclaredStrike(actor.entityId, target.id, next.spec.id)) return false;
        actor.nextAbility = null; return true;
      }
      for (const { min, max, ability, spec } of options) {
        if (ability.weight <= 0 || distance < min || distance > max) continue;
        if (ability.hpBelow !== undefined && actor.hp >= actor.maxHp * ability.hpBelow) continue;
        if (host.startDeclaredStrike(actor.entityId, target.id, spec.id)) return true;
      }
      return false;
    },
  };
}
function nativeRegistration<P>(id: string, actor: AnimalSim, divisor: number, brain: SimStateAdapter & { think: (ports: P) => void }, recipe: DeclaredBrainRecipe<P>, host: SimHost): Registration {
  if (typeof recipe.observe !== 'function' || typeof recipe.body !== 'function') throw new Error('Missing native brain recipe');
  const contract = JSON.stringify({ divisor, policy: brain.snapshot() });
  return { id, run: () => {
    if (!actor.alive) return;
    const decisionDt = host.brainDt(actor.entityId, false, divisor);
    if (decisionDt > 0) brain.think(recipe.observe(decisionDt));
    const bodyDt = host.bodyDt(actor.entityId); if (bodyDt > 0) recipe.body(bodyDt);
  }, adapter: { snapshot: () => contract, restore: saved => {
    if (saved !== contract) throw new Error('Incompatible native brain continuation');
  } } };
}
function mutableRegistration<P>(id: string, actor: AnimalSim, divisor: number,
  brain: SimStateAdapter & { readonly state: string; think: (ports: P) => void; act: (ports: P) => void }, recipe: DeclaredBrainRecipe<P>, host: SimHost, home?: ShardCreatureHome, phaseOffset?: number): Registration {
  const contract = JSON.stringify({ version: 1, divisor, ...(home === undefined ? {} : { home }), ...(phaseOffset === undefined ? {} : { phaseOffset }) });
  const sensed = recipe.nearest !== undefined && recipe.bindTarget !== undefined;
  let selected: string | null = null;
  if (sensed) recipe.bindTarget?.(() => {
    let player = selected === null ? undefined : host.players.get(selected);
    // The original policy phase owns retention. Perception gates a fresh
    // graze/orbit/patrol/drift acquisition, not an already committed action.
    if (player === undefined || !player.health.alive || host.parked.has(player.id)
      || brain.state === 'graze' || brain.state === 'circle' || brain.state === 'glide' || brain.state === 'drift') {
      player = recipe.nearest?.(); selected = player?.id ?? null;
    }
    return player;
  });
  return { id, run: () => {
    if (!actor.alive) return;
    const decisionDt = host.brainDt(actor.entityId, false, divisor);
    if (decisionDt > 0) brain.think(recipe.observe(decisionDt));
    const bodyDt = host.bodyDt(actor.entityId);
    if (bodyDt > 0) { brain.act(recipe.observe(bodyDt)); recipe.body(bodyDt); }
  }, adapter: { snapshot: () => sensed ? [contract, brain.snapshot(), selected !== null && host.players.has(selected) ? selected : null] : [contract, brain.snapshot()], restore: saved => {
    if (!Array.isArray(saved) || saved.length !== (sensed ? 3 : 2) || saved[0] !== contract || saved[1] === undefined
      || (sensed && saved[2] !== null && (typeof saved[2] !== 'string' || !host.players.has(saved[2])))) throw new Error('Incompatible native policy cadence continuation');
    brain.restore(saved[1]);
    if (sensed) selected = typeof saved[2] === 'string' ? saved[2] : null;
  } } };
}
/** Preflight every actor, declaration and native port before registering any callback; restore installs without running recipes. */
export function installDeclaredBrains(host: SimHost, rows: readonly DeclaredBrainSpawn[], declarations: readonly DeclaredNativeBrain[], ports: DeclaredBrainPorts = {}, layers?: ReadonlyMap<string, ResolvedCreatureLayers>): ReadonlyMap<string, SimStateAdapter> {
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
  const abilities = new Map<string, ReturnType<typeof prepareAbilities>>();
  const perception = new Map(pursueRows.map(row => {
    const actor = host.entities.get(row.id); if (actor === undefined) throw new Error('Missing pursuit senses body');
    const layer = layers?.get(row.species);
    if (layer !== undefined && layer.abilities.length > 0) abilities.set(row.id, prepareAbilities(host, actor, layer.abilities));
    return [row.id, bindCreatureSenses(host, actor, layer?.senses)] as const;
  }));
  const pursuits = preparePlatformBrains(host, pursueRows, presets.filter(row => row.kind === 'pursue'), ports.navigation,
    (actor, id) => { const player = host.players.get(id); return player !== undefined && perception.get(actor.entityId)?.notices(player) === true; },
    new Map([...abilities].map(([id, binding]) => [id, binding.request])));
  const social = new Map<string, { readonly id: string; readonly members: Set<ReturnType<AnimalSim['combatActor']>> }>();
  for (const row of rows) {
    if (row.group === undefined || layers?.get(row.species)?.temperament.pack !== true) continue;
    if (!social.has(row.group)) social.set(row.group, { id: row.group, members: new Set() });
    const membership = social.get(row.group), actor = host.entities.get(row.id);
    if (membership === undefined || actor === undefined) throw new Error('Unresolved social group actor');
    // Every set is built during preflight and read-only once callbacks start.
    membership.members.add(actor.combatActor());
  }
  const registrations: Registration[] = [];
  for (const row of rows) {
    if (row.brain === null) continue;
    const spec = definitions.get(row.brain), actor = host.entities.get(row.id), pursuit = pursuits.get(row.id), id = `brain.${row.id}`;
    if (spec === undefined || actor === undefined) throw new Error('Unresolved declared actor');
    switch (spec.kind) {
      case 'pursue': {
        if (pursuit === undefined) throw new Error('Unresolved pursuit policy');
        const layer = layers?.get(row.species);
        const source = { run: (_dt: number, acquire = true) => { pursuit.step(host.state.tick, acquire, host.brainDt(actor.entityId, false, spec.thinkDivisor) > 0); }, adapter: pursuit,
          notice: layer?.senses?.notice ?? spec.awareRadius, escapeSpeed: spec.speed, crowd: spec.stopDistance,
          ...(layer?.senses === undefined ? {} : { nearest: () => perception.get(row.id)?.nearest() }),
          provoke: (targetId: string) => { pursuit.provoke(targetId); } };
        const policy = layer !== undefined
          ? bindCreatureTemperament(host, actor, row.at, layer.temperament, source,
            () => { const target = pursuit.targetId; const player = target === null ? undefined : host.players.get(target); return player?.health.alive === true ? player.position : undefined; },
            row.group === undefined ? undefined : social.get(row.group)) : { ...source, run: (dt: number) => { source.run(dt); } };
        registrations.push({ id, ...policy }); break;
      }
      case 'skirmisher': {
        if (ports.skirmisher === undefined) throw new Error('Missing native brain port');
        const brain = new SkirmisherBrain(actor, spec), recipe = ports.skirmisher(actor, host, spec), layer = layers?.get(row.species);
        if (layer === undefined) registrations.push(nativeRegistration(id, actor, spec.thinkDivisor, brain, recipe, host));
        else {
          const native = bindGroundTemperament(host, actor, spec.thinkDivisor, brain, recipe);
          const policy = bindCreatureTemperament(host, actor, row.at, layer.temperament,
            { ...native, notice: layer.senses?.notice ?? spec.awareRadius, escapeSpeed: spec.fleeSpeed },
            () => native.target()?.position, row.group === undefined ? undefined : social.get(row.group));
          registrations.push({ id, ...policy, run: dt => { policy.run(dt); const bodyDt = host.bodyDt(actor.entityId); if (actor.alive && bodyDt > 0) recipe.body(bodyDt); } });
        }
        break;
      }
      case 'guardian': {
        if (ports.guardian === undefined) throw new Error('Missing native brain port');
        const brain = new GuardianBrain(actor, spec), recipe = ports.guardian(actor, host, spec), layer = layers?.get(row.species);
        if (layer === undefined) registrations.push(nativeRegistration(id, actor, spec.thinkDivisor, brain, recipe, host));
        else {
          // Native root lift moves the body below its floor; perception/home use the floor origin.
          const origin = { get x() { return actor.position.x; }, get y() { return actor.position.y - actor.yOffset; }, get z() { return actor.position.z; } };
          const native = bindGroundTemperament(host, actor, spec.thinkDivisor, brain, recipe, origin);
          const policy = bindCreatureTemperament(host, actor, row.at, layer.temperament,
            { ...native, origin, notice: layer.senses?.notice ?? spec.wakeRadius, escapeSpeed: spec.speed },
            () => native.target()?.position, row.group === undefined ? undefined : social.get(row.group));
          registrations.push({ id, ...policy, run: dt => {
            // Even a layer's first-frame flight needs the native owner to initialize its root memory.
            if (actor.alive && !actor.mem['init']) brain.think({ ...recipe.observe(0), calm: true });
            policy.run(dt); const bodyDt = host.bodyDt(actor.entityId); if (actor.alive && bodyDt > 0) recipe.body(bodyDt);
          } });
        }
        break;
      }
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
    for (const binding of abilities.values()) remove.push(binding.install());
    for (const registration of registrations) {
      const dispose = registration.install?.(); if (dispose !== undefined) remove.push(dispose);
      const actorId = registration.id.slice(6);
      remove.push(host.onStep(registration.id, dt => { if (host.bodyPresent(actorId)) registration.run(dt); }, registration.adapter)); result.set(actorId, registration.adapter);
    }
  } catch (error) { for (const undo of remove) undo(); throw error; }
  return result;
}
