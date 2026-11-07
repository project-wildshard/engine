import * as v from 'valibot';
import { Vector3 } from 'three';
import { actorDecisionRows, BorrowedDecisionSchema, parseDecisionScripts, type BorrowedDecision } from '@wildshard/format/decisionScripts';
import { parseWorldTargets, worldTargetSpots } from '@wildshard/format/worldTargets';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { ANIMAL_STATES } from '@wildshard/engine/entities/animalStates';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { parseActorMoves } from '@wildshard/format/actorMoves';
import { riseSteering } from '@wildshard/engine/ai/moves';
import { CreatureBodyRecipeSchema, type CreatureBodyRecipe } from '@wildshard/format/creatures';
import { StrikeRunner, type StrikeSpec } from '@wildshard/engine/ai/strikes';
import { readStrikeState } from '@wildshard/engine/ai/strikeState';
import { focusPlayer, ShardDecisions, type DecisionRuntime } from './decisions';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import type { SimHost } from '@wildshard/engine/sim';
import { canReach } from '@wildshard/engine/ai/reach';
import { sayFightView } from '@wildshard/engine/sim/shardRows';
import { BOSS_STRIKE } from '../../../shared/game/shardfile/wirePrompts';
import type { BorrowedSpeciesControl, SpeciesDecisionAuthority, SpeciesDecisionObservation } from '../plugin/brain';

/** Existing world services and fixed-step registration, lent by the page/native owner.
 * No body, physics world, encounter, interval or simulation is allocated here.
 */
export interface BorrowedDecisionPorts extends Pick<DecisionRuntime, 'scope' | 'events' | 'flags' | 'physics' | 'player' | 'groundHeightAt'> {
  readonly live: (actor: AnimalSim) => boolean;
  readonly fixed: (id: string, run: () => void, scope: DecisionRuntime['scope']) => void;
  /** Tell a host's views: a page on a server has no body to read a strike off. Absent on a page's own authority. */
  readonly say?: (name: string, args: readonly number[]) => void;
}
/** What a telegraph reads of a strike, for a page that holds no runner. */
function sayStrike(ports: BorrowedDecisionPorts, runner: StrikeRunner, actor: AnimalSim): void {
  const { spec } = runner;
  if (spec !== null) ports.say?.(`${BOSS_STRIKE}${spec.id}`, [runner.through, runner.yaw, actor.position.x, actor.position.z]);
}
/** Existing encounter owners look up the controller bound to their actual body. */
const nativeAuthorities = new WeakMap<SimHost, SpeciesDecisionAuthority>();
/** The existing native world's admitted guest authority, never a per-shard callback. */
export function nativeDecisions(host: SimHost): SpeciesDecisionAuthority {
  const value = nativeAuthorities.get(host); if (value === undefined) throw new Error('Missing native decision authority'); return value;
}
const controls = new WeakMap<object, BorrowedSpeciesControl>();
export function borrowedDecisionControl(actor: object): BorrowedSpeciesControl {
  const control = controls.get(actor); if (control === undefined) throw new Error('Encounter body has no admitted decision owner'); return control;
}
/** Bind a verified product to its existing renderer-free host. The existing after-body phase
 * keeps spawn and restored observation order equal; physics is read live across native restore. */
export function nativeDecisionAuthority(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, host: SimHost): SpeciesDecisionAuthority {
  const authority = borrowedDecisionAuthority(source, assets, outputDescriptor(source)?.sections ?? new Map(), { scope: host.scope,
    events: host.events, flags: host.flags, get physics(){return host.physics;}, player: focusPlayer(host), groundHeightAt: (x,z)=>host.groundHeightAt(x,z),
    live: actor => host.entities.get(actor.entityId) === actor,
    fixed: (id, run, scope) => { scope.onDispose(host.onStep(id, run, undefined, 'afterBodies')); },
    say: (name, args) => { sayFightView(host, name, args); },
  });
  nativeAuthorities.set(host, authority); return authority;
}
const finite = v.pipe(v.number(), v.finite());
const savedControl = v.strictObject({ version: v.literal(1), actor: v.string(), phase: v.pipe(finite, v.integer(), v.minValue(0), v.maxValue(255)),
  fighting: v.boolean(), decision: v.string(), strike: v.unknown() });
/** Bind only verified product rows to the retained species owner's existing body and contact ports. */
export function borrowedDecisionAuthority(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, sections: ReadonlyMap<string, unknown>,
  ports: BorrowedDecisionPorts): SpeciesDecisionAuthority {
  const bodies = new Map<string, DecisionRuntime['scope']>();
  const groups = spawnGroupDecisionAuthority(source, assets, sections, ports);
  ports.scope.onDispose(() => { bodies.clear(); });
  return { bind: (actor, input, bodyInput) => {
    const parsed: BorrowedDecision = v.parse(BorrowedDecisionSchema, input);
    const body = bodyInput === undefined ? undefined : v.parse(CreatureBodyRecipeSchema, bodyInput);
    if (parsed.group !== undefined) {
      const control = groups.bind(actor, parsed, body); controls.set(actor, control); return control;
    }
    if (parsed.actor === undefined) throw new Error('Missing borrowed actor');
    const row = { ...parsed, actor: parsed.actor };
    const states = body?.actions === undefined ? undefined : v.parse(v.array(v.picklist(ANIMAL_STATES)), body.actions.states);
    if (body !== undefined && (body.motion === 'flight') !== actor.flying) throw new Error('Decision pose requires its existing declared motor');
    if (body?.actions !== undefined && body.actions.actions.length > 0)
      throw new Error('Decision pose states cannot own another contact clock');
    const publicFields = source.state.shared.filter(field => field.privacy === 'public' && field.type !== 'string');
    for (const name of [body?.actions?.stateKey, body?.offset?.field]) if (name !== undefined && !publicFields.some(field => field.name === name))
      throw new Error('Decision pose requires its admitted numeric actor field');
    // Read and validate every mark before mutating the retained body's presentation.
    const pose = (): void => {
      const actions = body?.actions, offset = body?.offset;
      const state = actions === undefined ? 0 : actor.mem[actions.stateKey] ?? 0;
      const depth = offset === undefined ? 0 : actor.mem[offset.field] ?? 0;
      if (states !== undefined && (!Number.isInteger(state) || states[state] === undefined)) throw new Error('Invalid decision body state');
      if (!Number.isFinite(depth) || depth < 0 || depth > 1) throw new Error('Invalid normalized body offset');
      if (states !== undefined) { const name = states[state]; if (name !== undefined) actor.state = name; }
      if (offset !== undefined) actor.yOffset = offset.from + (offset.to - offset.from) * depth * depth * (3 - 2 * depth);
    };
    const script = parseDecisionScripts(sections.get('sim/scripts')).find(value => value.id === row.script);
    if (script === undefined || !Object.values(script.actors).includes(row.actor) || Object.values(script.actors).some(id => id !== row.actor))
      throw new Error('Borrowed decision must own exactly its admitted actor');
    const perch = row.perch === undefined ? undefined : worldTargetSpots(parseWorldTargets(sections.get('world/targets'))).get(row.perch);
    const idle = row.idle === undefined ? undefined : parseActorMoves(sections.get('actors/moves')).find(move => move.id === row.idle?.move);
    if (row.idle !== undefined && idle?.kind !== 'rise') throw new Error('Borrowed idle requires its admitted rise move');
    if (row.perch !== undefined && perch === undefined) throw new Error('Borrowed decision requires its admitted perch');
    bodies.get(row.actor)?.dispose();
    const scope = ports.scope.child(`decision:${row.actor}`), runner = new StrikeRunner(), state = { tick: 0, phase: 0, fighting: false };
    bodies.set(row.actor, scope);
    scope.onDispose(() => { if (bodies.get(row.actor) === scope) bodies.delete(row.actor); });
    const entities = new Map([[row.actor, actor]]), strikes = new Map([[row.actor, runner]]), catalogue = new Map<string, StrikeSpec>();
    // Movement-only guests have no combat capability to lend. Strike-capable species must be observed by
    // their actual manager/keeper before the first fixed step; a missing contact owner remains a refusal.
    let observation: SpeciesDecisionObservation | undefined = script.commands.includes('strike') ? undefined : {
      calm:false,reach:value=>canReach(value,ports.player.position,ports.physics),claim:()=>false,
      hurt:()=>{throw new Error('Movement-only guest has no strike capability');},
    };
    const admission: { owner?: ShardDecisions; initial?: string } = {};
    const owner = (): ShardDecisions => { if (admission.owner === undefined) throw new Error('Decision body is not admitted'); return admission.owner; };
    const control: BorrowedSpeciesControl = {
      get phase() { return row.marks === undefined ? state.phase : actor.mem[row.marks.phase] ?? 0; },
      set phase(value) { if (row.marks === undefined) state.phase = value; else actor.mem[row.marks.phase] = value; },
      get fighting() { return row.marks === undefined ? state.fighting : (actor.mem[row.marks.fight] ?? 0) >= 1; },
      set fighting(value) { if (row.marks === undefined) state.fighting = value; else actor.mem[row.marks.fight] = Number(value); }, get current() { return runner.spec; }, get windup() { return owner().strikeObservation(row.actor).windup; },
      get aim() { return runner.yaw; },
      observe: value => { observation = value; },
      restart: () => { runner.cancel(); actor.cancelAttack(); if (admission.initial === undefined) throw new Error('Decision initial state is not admitted');
        owner().restore(admission.initial); state.tick = owner().host.snapshot().tick;
        if (perch !== undefined) { actor.place(perch.x, perch.z, 0, perch.y); actor.yaw = perch.yaw; }
        actor.speed = 0; if (row.bankField !== undefined) actor.mem[row.bankField] = 0; },
      snapshot: () => JSON.stringify({ version: 1, actor: actor.entityId, phase: control.phase, fighting: control.fighting,
        decision: owner().snapshot(), strike: runner.snapshot() }),
      restore: value => {
        if (typeof value !== 'string') throw new Error('Invalid borrowed decision continuation');
        const saved = v.parse(savedControl, JSON.parse(value));
        if (saved.actor !== actor.entityId) throw new Error('Borrowed decision belongs to another body');
        const strike = readStrikeState(saved.strike, [...catalogue.values()]);
        owner().restore(saved.decision); runner.restore(strike, [...catalogue.values()]);
        state.tick = owner().host.snapshot().tick; control.phase = saved.phase; control.fighting = saved.fighting;
      },
    };
    controls.set(actor, control); scope.onDispose(() => { if (controls.get(actor) === control) controls.delete(actor); });
    const before: (() => void)[] = [], after: (() => void)[] = [], chest = new Vector3();
    const runtime: DecisionRuntime = { ...ports, get physics(){return ports.physics;}, scope, state, entities, strikes, slots: { ledgerDedupe: [] },
      borrowedActors: new Set([row.actor]), borrowedControls: new Map([[row.script, { get fighting() { return control.fighting && observation?.calm !== true && actor.alive; },
        get phase() { return control.phase; }, ...(row.leanField === undefined ? {} : { leanField: row.leanField }) }]]),
      registerStrikeCatalogue: (id, specs) => {
        if (id !== row.actor || catalogue.size > 0) throw new Error('Borrowed strike catalogue already owned');
        for (const spec of specs) catalogue.set(spec.id, { ...spec, weight: () => 1 });
        for (const effect of row.strikeEffects) if (!catalogue.has(effect.strike)) throw new Error('Borrowed strike effect is undeclared');
      },
      startDeclaredStrike: (id, target, strike) => {
        const spec = catalogue.get(strike), live = observation;
        if (id !== row.actor || target !== ports.player.id || spec === undefined || live === undefined || runner.busy || !live.reach(actor) || !live.claim(actor)) return false;
        chest.copy(ports.player.position); chest.y += row.strikeEffects.find(effect => effect.strike === strike)?.aimHeight ?? 0;
        runner.start(spec, actor, chest); return true;
      },
      onStep: (_id, run, _adapter, phase) => { const callbacks = phase === 'afterBodies' ? after : before; callbacks.push(run);
        return () => { const index = callbacks.indexOf(run); if (index !== -1) callbacks.splice(index, 1); }; },
    };
    const admitted = new Map(sections); admitted.set('sim/scripts', [script]);
    const decisions = new ShardDecisions(runtime, source, assets, admitted, new Map(), undefined, undefined, undefined, true);
    admission.owner = decisions; admission.initial = decisions.snapshot();
    // The existing world calls this once per fixed step; the integer is the guest's logical continuation index.
    ports.fixed(`decision:${row.actor}`, () => {
      if (!ports.live(actor)) { scope.dispose(); return; }
      const live = observation; if (live === undefined || scope.disposed) return;
      state.tick++; for (const run of before) run();
      const effect = row.strikeEffects.find(value => value.strike === runner.spec?.id);
      chest.copy(ports.player.position); chest.y += effect?.aimHeight ?? 0;
      runner.update(1 / 60, { actor, target: chest, canReach: () => live.reach(actor), hit: spec => {
        if (effect !== undefined && (effect.speed > 0 || effect.lift > 0) && live.shove === undefined) throw new Error('Decision strike requires its actual impulse authority');
        live.hurt(spec.damage); if (effect !== undefined && (effect.speed > 0 || effect.lift > 0)) live.shove?.(runner.yaw, effect.speed, effect.lift);
      } });
      sayStrike(ports, runner, actor);
      for (const run of after) run();
      pose();
      if (actor.alive && !control.fighting && idle?.kind === 'rise' && row.idle !== undefined) {
        const steering = riseSteering(idle, actor, actor.mem[row.idle.progress] ?? 0);
        actor.fly(steering.yaw, steering.speed, steering.altitude, steering.turn);
      }
    }, scope);
    // The perch is the declared idle pose; constructing/restoring does not execute the guest.
    control.restart();
    return control;
  } };
}

const savedGroup = v.strictObject({ actor: v.string(), decision: v.string(), strike: v.unknown() });
interface Member {
  actor: AnimalSim; runner: StrikeRunner; observation?: SpeciesDecisionObservation;
  effects: BorrowedDecision['strikeEffects']; control: BorrowedSpeciesControl;
}
/** Retained spawn groups share one admitted decision owner and module image. Only logical state,
 * contacts and RNG streams are actor-scoped; the existing keeper still owns bodies and saves.
 */
function spawnGroupDecisionAuthority(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, sections: ReadonlyMap<string, unknown>, ports: BorrowedDecisionPorts): {
  bind: (actor: AnimalSim, row: BorrowedDecision, body?: CreatureBodyRecipe) => BorrowedSpeciesControl;
} {
  const groups = new Map<string, ReturnType<typeof create>>();
  function create(scriptId: string, groupId: string) {
    const script = parseDecisionScripts(sections.get('sim/scripts')).find(row => row.id === scriptId);
    if (script === undefined || !('spawnGroup' in script.binding) || script.binding.spawnGroup !== groupId)
      throw new Error('Missing admitted spawn-group decision');
    const rows = actorDecisionRows(script), members = new Map<string, Member>();
    const scope = ports.scope.child(`decision:${groupId}`), state = { tick: 0 }, slots = { ledgerDedupe: [] };
    const entities = new Map<string, AnimalSim>(), strikes = new Map<string, StrikeRunner>(), catalogue = new Map<string, StrikeSpec>();
    const before: (() => void)[] = [], after: (() => void)[] = [], chest = new Vector3();
    let decisions: ShardDecisions | undefined;
    const owner = (): ShardDecisions => {
      if (decisions !== undefined) return decisions;
      if (Object.values(script.actors).some(id => !members.has(id))) throw new Error('Spawn-group bodies must be bound before stepping or saving');
      const memberControls = new Map(rows.map(row => {
        const id = Object.values(row.actors)[0]; if (id === undefined) throw new Error('Empty spawn group');
        return [row.id, { get fighting() { const member = members.get(id); return member !== undefined && member.actor.alive && ports.live(member.actor); },
          get calm() { return members.get(id)?.observation?.calm ?? true; }, phase: 0 }] as const;
      }));
      const runtime: DecisionRuntime = { ...ports, get physics() { return ports.physics; }, scope, state, slots, entities, strikes,
        borrowedActors: new Set(Object.values(script.actors)), borrowedControls: memberControls,
        registerStrikeCatalogue: (_id, specs) => { for (const spec of specs) catalogue.set(spec.id, { ...spec, weight: () => 1 }); },
        startDeclaredStrike: (id, target, strike) => {
          const member = members.get(id), spec = catalogue.get(strike), observation = member?.observation;
          if (member === undefined || observation === undefined || spec === undefined || target !== ports.player.id || member.runner.busy
            || !observation.reach(member.actor) || !observation.claim(member.actor)) return false;
          chest.copy(ports.player.position); chest.y += member.effects.find(effect => effect.strike === strike)?.aimHeight ?? 0;
          member.runner.start(spec, member.actor, chest); return true;
        },
        onStep: (_id, run, _adapter, phase) => { const callbacks = phase === 'afterBodies' ? after : before; callbacks.push(run);
          return () => { const index = callbacks.indexOf(run); if (index !== -1) callbacks.splice(index, 1); }; },
      };
      const admitted = new Map(sections); admitted.set('sim/scripts', [script]);
      decisions = new ShardDecisions(runtime, source, assets, admitted, new Map(), undefined, undefined, undefined, true);
      return decisions;
    };
    let steppingInstalled = false;
    const step = (): void => {
      owner(); state.tick++; for (const run of before) run();
      for (const member of members.values()) {
        const observation = member.observation, actor = member.actor;
        if (observation === undefined || !ports.live(actor)) continue;
        const effect = member.effects.find(value => value.strike === member.runner.spec?.id);
        chest.copy(ports.player.position); chest.y += effect?.aimHeight ?? 0;
        member.runner.update(1 / 60, { actor, target: chest, canReach: () => observation.reach(actor), hit: spec => {
          if (effect !== undefined && (effect.speed > 0 || effect.lift > 0) && observation.shove === undefined)
            throw new Error('Decision strike requires its actual impulse authority');
          observation.hurt(spec.damage);
          if (effect !== undefined && (effect.speed > 0 || effect.lift > 0)) observation.shove?.(member.runner.yaw, effect.speed, effect.lift);
        } });
      }
      for (const run of after) run();
    };
    scope.onDispose(() => { members.clear(); entities.clear(); strikes.clear(); });
    return { bind: (actor: AnimalSim, row: BorrowedDecision, body?: CreatureBodyRecipe): BorrowedSpeciesControl => {
      if (!Object.values(script.actors).includes(actor.entityId) || actor.flying || body?.motion !== 'ground' || body.actions !== undefined || body.offset !== undefined
        || row.perch !== undefined || row.idle !== undefined || row.marks !== undefined || row.leanField !== undefined || row.bankField !== undefined)
        throw new Error('Spawn-group binding requires its declared ground body');
      const previous = members.get(actor.entityId);
      if (previous?.actor === actor) return previous.control;
      const runner = new StrikeRunner();
      const control: BorrowedSpeciesControl = {
        phase: 0, fighting: true, get current() { return runner.spec; }, get windup() { return owner().strikeObservation(actor.entityId).windup; }, get aim() { return runner.yaw; },
        observe: observation => { const member = members.get(actor.entityId); if (member?.actor === actor) member.observation = observation; },
        restart: () => { runner.cancel(); actor.cancelAttack(); owner().restartActor(actor.entityId); },
        snapshot: () => JSON.stringify({ actor: actor.entityId, decision: owner().snapshot(), strike: runner.snapshot() }),
        restore: input => {
          if (typeof input !== 'string') throw new Error('Invalid group continuation');
          const value = v.parse(savedGroup, JSON.parse(input));
          if (value.actor !== actor.entityId) throw new Error('Group continuation belongs to another actor');
          const controller = owner(), strike = readStrikeState(value.strike, [...catalogue.values()]);
          controller.restore(value.decision); runner.restore(strike, [...catalogue.values()]); state.tick = controller.host.snapshot().tick;
        },
      };
      members.set(actor.entityId, { actor, runner, effects: row.strikeEffects, control }); entities.set(actor.entityId, actor); strikes.set(actor.entityId, runner);
      for (const field of source.state.shared.filter(candidate => candidate.privacy === 'public' && candidate.type !== 'string')) actor.mem[field.name] = Number(field.default);
      if (decisions !== undefined) decisions.restartActor(actor.entityId);
      // Population construction may yield between bodies. Publish no fixed-step
      // callback until every declared member is bound; snapshots still refuse
      // an incomplete group through owner(), rather than inventing empty state.
      if (!steppingInstalled && Object.values(script.actors).every(id => members.has(id))) {
        steppingInstalled = true; ports.fixed(`decision:${groupId}`, step, scope);
      }
      return control;
    } };
  }
  return { bind: (actor, row, body) => {
    if (row.group === undefined) throw new Error('Missing spawn-group identity');
    const key = `${row.script}:${row.group}`;
    let group = groups.get(key); if (group === undefined) { group = create(row.script, row.group); groups.set(key, group); }
    return group.bind(actor, row, body);
  } };
}
