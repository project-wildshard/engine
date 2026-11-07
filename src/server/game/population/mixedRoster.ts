import { nativeDecisions } from '../shardfile/borrowedDecisions';
import { MixedPopulationSchema } from '@wildshard/format/mixedPopulation';
import { PopulationKeeperRowsSchema } from '@wildshard/format/populationKeeper';
import type { SpeciesPrograms } from '@wildshard/format/speciesPrograms';
import type { AnimalRigContext } from '@wildshard/engine/entities/animalRig';
import { createNativeCreaturePoses, stepCreatureLift, type NativeCreaturePoseRecipe } from '../../../shared/game/plugin/animation';
import { numericCreaturePose } from '../../../shared/game/plugin/channelPrograms';
import { createNativeHunt, createNativeSpeciesContext, admitSpeciesProgram } from '../plugin/brain';
import { bindPerchBody, nativePerchProgram } from './perchBody';
import { stepPerchRoot } from '../../../shared/game/population/perchRoot';
import { installPopulationEnvironment, populationEnvironment } from './environment';
import { NativeManager } from './nativeManager';
import { ReturnGate } from '../../../shared/game/population/respawn';
import { admitNativeRosterServices, createNativeCreatureRoster, orderedNativeReinstall, type NativeCreatureSlot, type KeptPolicy } from '../shardfile/homeKeeper';
import * as v from 'valibot';
import { Euler, Vector3 } from 'three';
import { publishScriptBody } from '@wildshard/engine/sim/shardRows';
import { volleyRow } from '../../../shared/game/shardfile/wirePrompts';
import { Rng } from '@wildshard/engine/core/rng';
import type { AnimalSim, AnimalSimSpec } from '@wildshard/engine/entities/AnimalSim';
import type { HuntBody, HuntNav, HuntSpecies } from '@wildshard/engine/ai/hunt';
import { Bodies, RowBodySlots, type BodyLaunchRow } from '@wildshard/engine/physics/bodies';
import type { SimHost } from '@wildshard/engine/sim';
import type { SimSnapshot } from '@wildshard/engine/sim/snapshot';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';

export interface MixedPopulationBody extends NativeCreatureSlot { brain: KeptPolicy | null }
/** Trusted native products contain data only. Queries are resolved on installed hosts. */
export interface MixedPopulationInput {
  readonly rows: unknown; readonly keeper: unknown; readonly perchProgram: unknown;
  readonly population: SpeciesPrograms;
  readonly launch: BodyLaunchRow;
  readonly placement: { readonly seed: number; readonly native: { readonly stream: ReturnType<Rng['snapshot']> } };
  readonly fauna: ReadonlyMap<string, HuntSpecies>; readonly specs: ReadonlyMap<string, AnimalSimSpec>;
  readonly bake: {
    readonly ground: { readonly heights: Float32Array; readonly scale: { readonly x: number } };
    readonly actors: readonly { readonly kind: string; readonly variant: string; readonly pose: NativeCreaturePoseRecipe }[];
    readonly herds: readonly unknown[];
    readonly habitat: { readonly perches: readonly { readonly x: number; readonly y: number; readonly z: number }[];
      readonly perchBases: readonly { readonly x: number; readonly y: number; readonly z: number }[];
      readonly hold: { readonly x: number; readonly z: number; readonly r: number; readonly guardR: number; readonly step: number; readonly floor: readonly (number | null)[] } };
  };
  readonly reserved: { readonly pose: NativeCreaturePoseRecipe; readonly pool: { readonly x: number; readonly z: number; readonly yaw: number } };
  readonly seed: number; readonly spawnY: number; readonly waterLevel: number; readonly nav: HuntNav | null;
}
// The retained continuation predates canonical product JSON. Rebuild its typed
// records in wire order before native actor/pose owners capture their contracts.
function continuationDims(input: AnimalSimSpec['dims']): AnimalSimSpec['dims'] {
  const { bodyY, bodyHalfLen, bodyRadius, headRadius, legLen, feet, halfWidth, ...rest } = input;
  return { bodyY, bodyHalfLen, bodyRadius, headRadius, legLen, feet, halfWidth, ...rest };
}
function continuationSpec(input: AnimalSimSpec): AnimalSimSpec {
  const { kind, label, variant, rarity, hp, aggressive, mods, dims, ...rest } = input;
  return { kind, label, variant, rarity, hp, aggressive,
    mods: { speed: mods.speed, chargeDist: mods.chargeDist, damageTaken: mods.damageTaken, chargeDamage: mods.chargeDamage, relentless: mods.relentless },
    dims: continuationDims(dims), ...rest };
}
function continuationPose(input: NativeCreaturePoseRecipe): NativeCreaturePoseRecipe {
  const { joints, custom, pose, ...rest } = input;
  return { joints: joints.map(({ name, parent, position, order, scale }) => ({ name, parent, position, order, scale })), custom,
    ...(pose === undefined ? {} : { pose: { grazeNeck: pose.grazeNeck, gallopTail: pose.gallopTail } }), ...rest };
}
const finite = v.pipe(v.number(), v.finite());
const Stream = v.strictObject({ version: v.literal(1), state: finite, initial: finite, scrambledFork: v.boolean() });
const Point = v.tuple([finite, finite, finite]);

const Memory = v.strictObject({ timer: finite, tx: finite, tz: finite, fleeT: finite, fleeUntil: finite, chargeCd: finite, callT: finite, awareness: finite,
  freeze: finite, spooked: v.boolean(), wary: finite, sensed: v.boolean(), windup: finite, backoff: finite, side: finite, committed: v.boolean(),
  path: v.array(Point), pathI: finite, goalX: finite, goalZ: finite, repathAt: finite });

const Respawn = v.strictObject({ kind: v.string(), variant: v.string(), herd: finite, x: finite, z: finite, due: finite, night: v.boolean(), id: v.string() });
const savedSchema = (count: number, ROSTER: number) => {
  const Slot = v.strictObject({ k: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(count - 1)), state: v.picklist([1, 2]), rest: finite, age: finite,
    thrower: v.pipe(v.number(), v.integer(), v.minValue(-1), v.maxValue(ROSTER - 1)), handle: finite, wet: finite });
  return v.strictObject({ version: v.literal(8), rng: Stream, ecology: v.strictObject({ now: finite, check: finite, pending: v.pipe(v.array(Respawn), v.maxLength(ROSTER)) }),
  coconuts: v.strictObject({ rng: Stream, next: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(count - 1)), slots: v.array(Slot) }),
  fauna: v.strictObject({ clock: finite, speed: finite, prev: v.nullable(Point), memories: v.array(v.nullable(Memory)), sight: v.array(v.nullable(v.boolean())) }), tokens: v.array(v.string()), herds: v.array(v.tuple([finite, finite])),
  bodies: v.array(v.strictObject({ id: v.string(), kind: v.string(), variant: v.string(), herd: finite, live: v.boolean(), pose: v.nullable(v.string()), policy: v.nullable(v.string()) })),
  captain: v.nullable(v.strictObject({ id: v.string(), pose: v.string(), policy: v.nullable(v.union([v.boolean(),v.string()])) })),
  practice: v.strictObject({ dead: finite, fade: finite }), ids: v.strictObject({ next: v.pipe(v.number(), v.integer(), v.minValue(0)), used: v.array(v.string()) }) });
};

const populations = new WeakMap<SimHost, Map<string, ReturnType<typeof installMixedPopulation>>>();
export function mixedPopulation(host: SimHost, id: string): ReturnType<typeof installMixedPopulation> {
  const value = populations.get(host)?.get(id); if (value === undefined) throw new Error('Missing mixed population'); return value;
}
/** Mixed native population host. Rows own policy selection, reserved slots,
 * return gates, pose services and the physical volley's before/after boundary.
 * The v8 continuation retains per-body policies, poses, ids and native handles. */
export function installMixedPopulation(host: SimHost, ports: MixedPopulationInput, saved?: Readonly<SimSnapshot>): {
  bodies: () => readonly MixedPopulationBody[]; hunt: ReturnType<typeof createNativeHunt>['hunt'];
  captain: () => HuntBody | null; spawnCaptain: () => HuntBody; alarm: () => void;
  staggered: (actor: AnimalSim, strength: number, running: boolean) => void;
  settle: () => void; publishPoses: () => void;
} {
  const rows = v.parse(MixedPopulationSchema, ports.rows), roster = v.parse(PopulationKeeperRowsSchema, ports.keeper);
  const { program, hunt: settings } = ports.population;
  const ROSTER = rows.limit, BODY_COUNT = roster.bodies.length, FAUNA = new Set(rows.hunted), ISLAND_STEP = rows.step;
  if (BODY_COUNT >= ROSTER || roster.bodies.filter(row => row.practice).length !== 1) throw new Error('Invalid mixed population slots');
  const perch = nativePerchProgram(host, ports.perchProgram);
  const Saved = savedSchema(roster.volley.count, ROSTER);
  const practiceRule = rows.practice;
  if (program === undefined || settings === undefined) throw new Error('Mixed population requires its admitted creature recipes');
  const brains = admitSpeciesProgram(program);
  const contact = program.strikes.find(row => row.id === rows.volley.strike), bite = program.strikes.find(row => row.id === rows.perch.strike);
  if (contact === undefined || bite === undefined) throw new Error('Mixed population requires its admitted volley contacts');
  const biteStrike = strikeFromData(bite);

  const { bake } = ports, specs = new Map([...ports.specs].map(([kind, spec]) => [kind, continuationSpec(spec)])),
    rng = new Rng(ports.seed + 31), bodies: MixedPopulationBody[] = [], player = host.playerFocus;

  installPopulationEnvironment(host, { res: Math.sqrt(bake.ground.heights.length), size: bake.ground.scale.x, heights: bake.ground.heights }, roster.environment);
  const ground = populationEnvironment(host, roster.environment.id), heightAt = ground.heightAt;
  const lattice = bake.habitat.hold, side = Math.round(2 * lattice.guardR / lattice.step) + 1;
  if (lattice.floor.length !== side * side) throw new Error('Invalid habitat floor lattice');
  const holdFloorAt = (x: number, z: number): number | undefined => {
    const ix = Math.round((x - lattice.x + lattice.guardR) / lattice.step), iz = Math.round((z - lattice.z + lattice.guardR) / lattice.step);
    return ix < 0 || iz < 0 || ix >= side || iz >= side ? undefined : lattice.floor[iz * side + ix] ?? undefined;
  };
  const { hunt, reach } = createNativeHunt(host, settings, { rng, ground, nav: ports.nav, species: ports.fauna });
  const habitat = bake.habitat;
  if (ports.seed !== ports.placement.seed) throw new Error('Enemy placements require their authored seed');
  const PRACTICE_AT = rows.practice.at, stream = new Rng(0); stream.restore(ports.placement.native.stream);
  const placed = { ...ports.placement.native, stream };

  let service = new Bodies(host.physics, player);
  const volley = new RowBodySlots<HuntBody>(roster.volley, service, { kind: rows.volley.owner }, host.physics, host);
  // A coconut is a body only the server has: a client draws it off a row, or a monkey's throw lands out of nowhere.
  for (const [slot, pose] of volley.poses.entries()) {
    const euler = new Euler(), view = { position: pose.at, euler, enabled: false };
    publishScriptBody(host, volleyRow(rows.volley.owner, slot), () => { euler.setFromQuaternion(pose.rotation); view.enabled = pose.visible; return view; });
  }
  const world = {
    perches: habitat.perches.map(p => new Vector3(p.x, p.y, p.z)), perchBases: habitat.perchBases.map(p => new Vector3(p.x, p.y, p.z)),
    hold: { x: habitat.hold.x, z: habitat.hold.z, r: habitat.hold.r, guardR: habitat.hold.guardR, floorAt: holdFloorAt },

    throwCoconut: (from: Vector3, to: Vector3, thrower: HuntBody): void => { volley.throw(ports.launch, from, to, thrower, placed.stream); },
  };
  const brainPorts = { host, hunt, rng, world, heightAt, waterLevel: ports.waterLevel };
  const callbacks = new Map(rows.poses.map(row => {
    const clips = row.clips.map(numericCreaturePose);
    return [row.kind, (c: AnimalRigContext): void => {
      if (row.lift !== undefined) stepCreatureLift(c.animal, c.dt, ...row.lift);
      if (row.kind === rows.perch.kind) stepPerchRoot(c, rows.perch.root);
      for (const pose of clips) pose(c);
    }] as const;
  }));
  const poses = createNativeCreaturePoses([...bake.actors, { kind: rows.reserve.kind, variant: rows.reserve.variant, pose: ports.reserved.pose }]
    .map(({ kind, variant, pose }) => ({ kind, variant, pose: continuationPose(pose) })), ROSTER, callbacks);

  const intake = createNativeCreatureRoster<MixedPopulationBody>(host, {
    specs: specs.values(), variants: new Map(roster.variants.map(row => [row.kind, row.rows])),
    rng, spawnY: ports.spawnY, bodyPhase: roster.bodyPhase, attackTurnCap: rows.attackTurnCap, heightfield: 'any', services: admitNativeRosterServices(host, ISLAND_STEP, hunt, poses), hunted: [...FAUNA] });
  const entityIds = intake.identities;
  for (let i = 0; i < BODY_COUNT; i++) entityIds.allocate();

  const holdFloor = (x: number, z: number, fromY: number): number => holdFloorAt(x, z) ?? intake.floor(x, z, fromY);
  const join = (body: MixedPopulationBody, actor: HuntBody): void => {
    if (rows.floorKinds.includes(body.kind) && actor.levelGround) actor.groundHeight = holdFloor;
    if (FAUNA.has(body.kind)) { body.brain = null; return; }
    const context = createNativeSpeciesContext(brainPorts, actor, hunt.herds[body.herd]?.members ?? null, body.recipe.spec.label);
    const declared = program.species.find(row => row.kind === body.kind);
    if (declared?.brain?.archetype === 'decision') {
      const policy = brains.body(body.kind, actor, { host, stream: rng, decisions: nativeDecisions(host), attacks: { kind: 'keeper', claim: () => context.observation.claim(actor) } });
      if (policy === null) throw new Error('Missing declared decision body policy');
      body.brain = policy; return;
    }
    const actions = brains.actions(body.kind, actor);
    if (actions !== null) { body.brain = context.bind(context.observation, actions, actions); return; }
    if (body.kind === rows.perch.kind) {
      const decision = brains.decision(body.kind, actor);
      body.brain = context.bind(context.observation, bindPerchBody(actor, context.observation, decision, biteStrike, perch, rows.perch), decision.policy); return;
    }
    const policy = brains.body(body.kind, actor, { host, stream: rng, decisions: nativeDecisions(host), attacks: { kind: 'keeper', claim: () => context.observation.claim(actor) } });
    if (policy === null) throw new Error('Missing mixed population body policy');
    body.brain = policy;
  };
  const { draw } = intake;
  const place = (body: MixedPopulationBody): void => { join(body, intake.arrive(body)); };
  const enemyBody = (id: string, kind: string, variant: string, herd: number, at: { x: number; z: number }, yaw: number): MixedPopulationBody =>
    ({ ...intake.body(id, kind, variant, herd, at, yaw), brain: null });
  const boot = roster.fauna;
  if (roster.seed !== ports.seed) throw new Error('Keeper rows belong to another seed');
  const bootBody = (row: v.InferOutput<typeof PopulationKeeperRowsSchema>['bodies'][number]): MixedPopulationBody => ({ ...intake.body(row.id, row.kind, row.variant,
    row.herd, row, row.yaw, row.fauna ? [row.scale, row.scale] : undefined, row), brain: null });
  roster.herds.forEach(row => { hunt.addHerd(row.kind, row.x, row.z); });
  const practice: { body: MixedPopulationBody | null; dead: number; fade: number } = { body: null, dead: 0, fade: -1 };

  let captain: MixedPopulationBody | null = null;
  const captainBody = (id: string): MixedPopulationBody => ({ ...intake.body(id, rows.reserve.kind, rows.reserve.variant, -1, ports.reserved.pool, ports.reserved.pool.yaw, rows.reserve.scale), brain: null });

  const rosterAt = (i: number): MixedPopulationBody | null => (i === BODY_COUNT ? captain : bodies[i < BODY_COUNT ? i : i - 1]) ?? null;

  const still = (a: HuntBody): boolean => a.alive && (FAUNA.has(a.kind) ? a.state === 'charge' : a.attackPhase >= 0);

  const continuation = new NativeManager(host, hunt, rng, { limit: settings.limit, sightSlots: ROSTER, initialSight: null,
    ...(settings.memoryFields === undefined ? {} : { memoryFields: settings.memoryFields }) });
  const sight = continuation.sight;

  const tracked = continuation.noise;
  if (saved === undefined) {
    for (const [i, row] of roster.bodies.entries()) {
      const body = bootBody(row); if (row.stream !== null) rng.restore(row.stream);
      place(body); bodies.push(body); if (row.practice) practice.body = body;
      if (i + 1 === boot.rows.length) intake.adopt(boot.rows, boot.stream);
    }
    if (practice.body === null) throw new Error('Missing practice body');
  }

  const replacePractice = (body: MixedPopulationBody): void => {
    join(body, intake.refill(body, PRACTICE_AT));
    if (FAUNA.has(body.kind)) intake.remember(body);

    const i = bodies.indexOf(body); sight[i] = null;
    practice.dead = 0; practice.fade = -1;
  };
  const cadence = hunt.bindRoster({ limit: ROSTER, order: 'interrupt', at: rosterAt, actor: body => body.actor,
    id: body => body.id, player, noise: tracked, sight, reach, brainDt: (id, urgent) => host.brainDt(id, urgent),
    policy: body => body.brain, herd: body => body.herd, beforeDecisions: () => { hunt.tokens.sweep(still); } });
  const wake = cadence.wake;
  host.events.on('damage.dealt', ({ req, killed }) => { cadence.damaged(req.target, killed); }, host.scope);

  const first = roster.bodies[0]; if (first === undefined) throw new Error('Empty mixed population roster');
  const extra = Array.from({ length: ROSTER - BODY_COUNT - 1 }, () => enemyBody('', first.kind, first.variant, -1, { x: 0, z: 0 }, 0));
  const returns = intake.returns(roster.ecology);
  /** A slot a retired body left. Boot slots stay their row's: a continuation rebuilds those from the rows, not the save. */
  const vacated = (): number => { for (let i = BODY_COUNT; i < bodies.length; i++) if (bodies[i]?.actor === null) return i; return -1; };
  const retireFallen = (id: string): void => { const fallen = intake.retireDead(id); if (fallen !== null) fallen.brain = null; };
  const respawns = (dt: number): void => {
    for (const pending of returns.take(dt)) {
      const entry = returns.place(pending); if (entry === null) continue;
      const { x, z } = entry;
      // Below the bound a return takes the next slot and retires its predecessor after, as every save records. At the
      // bound it takes a vacated slot instead, so a long session keeps its roster; with none, the world is full of live
      // bodies and the spot is forgiven.
      const grow = bodies.length + 1 < ROSTER;
      if (!grow) retireFallen(entry.id);
      const at = grow ? bodies.length : vacated();
      if (at === -1) continue;
      const body = intake.retarget(grow ? extra[at - BODY_COUNT] : bodies[at], entry.kind, entry.variant, entry.herd, x, z, 'spawn');
      draw(body, !FAUNA.has(body.kind));
      if (rows.floorKinds.includes(body.kind)) { body.recipe.at.y = holdFloorAt(x, z) ?? heightAt(x, z); join(body, intake.materialize(body, body.recipe, true)); } else place(body);
      if (FAUNA.has(body.kind)) intake.remember(body);
      if (grow) { retireFallen(entry.id); bodies.push(body); } else sight[at + 1] = null; // rosterAt's index: the captain sits at BODY_COUNT
    }
  };
  host.useBodyStep({
    before: (id, _actor, dt) => { if (intake.beforeBody(id, dt)) intake.byId.get(id)?.brain?.move(dt); },
    after: (id, _actor, dt) => { intake.afterBody(id, dt); },
  });
  const keep = (): void => { host.onStep(ISLAND_STEP, dt => {

    service.post(dt);
    continuation.advance(dt);
    cadence.observe(dt); cadence.decide();

    volley.update(dt, 1, player);
    for (const effect of volley.takeEvents()) if (effect.kind === 'contact' && effect.source !== null) {
      const th = effect.source;
      host.combat.hit({ source: 'env', sourceTags: rows.volley.tags, target: host.nearestPlayer(th.position).health,
        amount: contact.damage, moveId: contact.id, point: th.position.clone(), dir: new Vector3(), cause: { kind: th.kind, label: th.label } });
    }
    service.pre(dt);
    respawns(dt);
    const crab = practice.body?.actor ?? null;
    if (crab === null || crab.alive || practice.body === null) return;
    if (ReturnGate.step(practice, { ...practiceRule, fade: rows.practice.fade }, dt, crab.alive,
      Math.hypot(player.x - PRACTICE_AT.x, player.z - PRACTICE_AT.z)) === 'replace') replacePractice(practice.body);
  }, {
    snapshot: () => { const common = continuation.snapshot(bodies.map(body => body.actor === null ? null : body.id),
      bodies.flatMap(body => body.actor !== null && body.brain === null ? [body.id] : [])); return ({ version: 8, rng: common.rng, ecology: returns.snapshot(),
      coconuts: { rng: { ...placed.stream.snapshot() }, ...volley.snapshot(bodies.map(b => b.actor?.entityId ?? '')) },
      tokens: [...bodies, ...(captain === null ? [] : [captain])].flatMap(b => b.actor !== null && hunt.tokens.enabled && hunt.tokens.holds(b.actor) ? [b.id] : []),
      fauna: { clock: common.clock, speed: common.noise.speed, prev: common.noise.seen ? common.noise.prev : null,
        memories: common.memories, sight: common.sight },
      herds: common.herds, practice: { dead: practice.dead, fade: practice.fade }, ids: entityIds.allocatorState(),
      bodies: bodies.map(b => ({ id: b.id, kind: b.kind, variant: b.variant, herd: b.herd, live: b.actor !== null, pose: b.actor === null ? null : poses.get(b.id)?.snapshot() ?? null, policy: b.brain === null ? null : JSON.stringify(b.brain.snapshot()) })),
      captain: captain === null ? null : { id: captain.id, pose: poses.get(captain.id)?.snapshot() ?? '', policy: captain.brain === null ? null : v.parse(v.union([v.boolean(),v.string()]), captain.brain.snapshot()) } }); },
    restore: value => {
      const state = v.parse(Saved, value);
      if (state.bodies.length !== bodies.length || state.herds.length !== hunt.herds.length
        || state.fauna.memories.length !== bodies.length || state.fauna.sight.length !== ROSTER || state.captain?.id !== captain?.id
        || state.bodies.some((b, i) => { const body = bodies.at(i); return body === undefined || b.id !== body.id || b.live !== (body.actor !== null); })) throw new Error('Incompatible Mixed population population continuation');
      const holders = state.tokens.map(id => { const a = (captain?.id === id ? captain : bodies.find(b => b.id === id))?.actor ?? null; if (a === null) throw new Error('Unknown Mixed population token holder'); return a; });
      placed.stream.restore(state.coconuts.rng);
      volley.restore(state.coconuts, bodies.map(b => b.actor));
      returns.restore(state.ecology);
      practice.dead = state.practice.dead; practice.fade = state.practice.fade; entityIds.restoreAllocator(state.ids);
      hunt.tokens.clear(); holders.forEach(a => { hunt.tokens.take(a); });
      state.bodies.forEach(b => { if ((b.pose !== null) !== b.live) throw new Error('Missing Mixed population pose continuation'); if (b.pose !== null) poses.get(b.id)?.restore(b.pose); });
      if (state.captain !== null) poses.get(state.captain.id)?.restore(state.captain.pose);
      state.bodies.forEach((b, i) => { if (b.policy !== null) bodies[i]?.brain?.restore(v.parse(v.string(), JSON.parse(b.policy))); });
      if (state.captain !== null && state.captain.policy !== null) {
        const actor = captain?.actor;
        if (typeof state.captain.policy === 'boolean' && actor !== null && actor !== undefined) {
          for (const row of rows.reserve.legacyMemory) actor.mem[row.to] = actor.mem[row.from] ?? actor.mem[row.to] ?? (row.axis === 'x' ? actor.position.x : row.axis === 'z' ? actor.position.z : 0);
        } else captain?.brain?.restore(state.captain.policy);
      }
      continuation.restore({ clock: state.fauna.clock, rng: state.rng, noise: { speed: state.fauna.speed, seen: state.fauna.prev !== null,
        prev: state.fauna.prev ?? [0, 0, 0] }, sight: state.fauna.sight, memories: state.fauna.memories, herds: state.herds },
        bodies.map(body => body.actor === null ? null : body.id), bodies.flatMap(body => body.actor !== null && body.brain === null ? [body.id] : []));
    },

    physicsRestored: () => { service = new Bodies(host.physics, player); volley.bind(service); },
  }); };
  const spawnCaptain = (): HuntBody => {
    if (captain !== null) throw new Error('The Mixed population captain is spawned once');
    const body = captainBody(entityIds.allocate());
    draw(body); place(body); captain = body;
    if (body.actor === null) throw new Error('The Mixed population captain did not spawn');
    return body.actor;
  };
  const alarm = (): void => {
    for (let i = 0; i < Math.min(ROSTER, bodies.length); i++) { const body = bodies[i], a = body?.actor ?? null; if (a !== null && a.alive && (a.aggressive || hunt.sensed(a))) wake(body); }
  };

  host.events.on('player.dodge', alarm, host.scope);
  const staggered = (a: AnimalSim, strength: number, running: boolean): void => {
    const body = bodies.find(b => b.actor === a && b.brain === null)?.actor ?? null;
    if (body !== null) hunt.staggered(body, strength, running);
  };
  const publishPoses = (): void => { poses.publish(i => rosterAt(i)?.actor?.entityId); };
  const publish = (value: ReturnType<typeof installMixedPopulation>): ReturnType<typeof installMixedPopulation> => {
    const book = populations.get(host) ?? new Map<string, ReturnType<typeof installMixedPopulation>>();
    if (book.has(rows.step)) throw new Error('Duplicate mixed population');
    book.set(rows.step, value); populations.set(host, book); host.scope.onDispose(() => { book.delete(rows.step); }); return value;
  };
  const population = { publishPoses, bodies: () => bodies, hunt, captain: () => captain?.actor ?? null, spawnCaptain, alarm, staggered };
  if (saved === undefined) { keep(); return publish({ ...population, settle: () => undefined }); }

  const keeper = v.parse(Saved, saved.adapters.find(adapter => adapter.id === ISLAND_STEP)?.state);
  if (keeper.bodies.length < BODY_COUNT || keeper.bodies.length >= ROSTER || keeper.herds.length < bake.herds.length) throw new Error('Incompatible Mixed population population continuation');

  keeper.herds.slice(bake.herds.length).forEach(([cx, cz]) => { hunt.addHerd(roster.bodies.find(row => row.practice)?.kind ?? first.kind, cx, cz); });
  const reinstall = (body: MixedPopulationBody): void => {
    join(body, intake.reinstall(body, saved));

    if (body.actor !== null && FAUNA.has(body.kind)) hunt.adopt(body.actor, body.recipe.at.x, body.recipe.at.z);
  };

  roster.bodies.forEach(row => { const body = bootBody(row); bodies.push(body); if (row.practice) practice.body = body; });
  keeper.bodies.slice(BODY_COUNT).forEach(b => { bodies.push(enemyBody(b.id, b.kind, b.variant, b.herd, { x: 0, z: 0 }, 0)); });

  const slot = practice.body;
  if (slot !== null) slot.herd = keeper.bodies[bodies.indexOf(slot)]?.herd ?? slot.herd;

  const slotId = slot === null ? undefined : keeper.bodies[bodies.indexOf(slot)]?.id;
  if (slot !== null && slotId !== undefined) { slot.id = slotId; slot.recipe.id = slotId; }

  if (keeper.captain !== null) captain = captainBody(keeper.captain.id);
  const live = [...bodies.filter((_, i) => keeper.bodies[i]?.live === true), ...(captain === null ? [] : [captain])];
  return publish({ ...population, settle: orderedNativeReinstall(saved, ISLAND_STEP, live, reinstall, keep) });
}
