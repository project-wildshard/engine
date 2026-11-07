import type { Scope } from '@wildshard/engine/app/scope';
import type { GroupGuestProjectionV2 } from '@wildshard/engine/ai/GroupBrain';
import { NativeWildEnvironment, type WildSenses } from '../population/nativeManager';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { bakedSamplers, type BakedGrid } from '@wildshard/engine/world/BakedTerrain';
import { CharacterMotor } from '@wildshard/engine/physics/CharacterMotor';
import { StrikeRunner } from '@wildshard/engine/ai/strikes';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { NativeGroupRowsSchema } from '@wildshard/format/creatures';
import * as v from 'valibot';
import { Vector3 } from 'three';
import type { FlockBrain } from '@wildshard/engine/ai/flock';
import { PackBrain, type PackPorts, type PackContext, type PackPrey } from '@wildshard/engine/ai/pack';
import { HerdBrain, type HerdPorts, type HerdContext } from '@wildshard/engine/ai/herd';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost } from '@wildshard/engine/sim';
import type { Rng, RngState } from '@wildshard/engine/core/rng';
import { nativeGroupBrain, groupBrainRules, type ShardGroupBrain, type ShardPackGroup, type ShardHerdGroup } from '@wildshard/format/groupBrains';

/** One group continuation; actor memory, motors and random streams remain with the simulation owner. */
export type DeclaredGroupPolicy = PackBrain<AnimalSim> | HerdBrain<AnimalSim>;
/** Trusted pack perception, prey/contact identities and per-actor steering observations. Recipe construction is pure. */
export interface DeclaredPackRecipe {
  ports: PackPorts<AnimalSim>;
  observe: (actor: AnimalSim, dt: number) => PackContext<AnimalSim>;
  confine: (actor: AnimalSim) => void;
}
/** Trusted herd perception, taming/contact identities and per-actor steering observations. Recipe construction is pure. */
export interface DeclaredHerdRecipe {
  ports: HerdPorts<AnimalSim>;
  observe: (actor: AnimalSim, dt: number) => HerdContext<AnimalSim>;
}
/** Native recipes for declared groups; no author callback receives the world or chooses an actor binding. */
export interface DeclaredGroupPorts {
  pack?: (group: ShardPackGroup, members: readonly AnimalSim[], host: SimHost) => DeclaredPackRecipe;
  herd?: (group: ShardHerdGroup, members: readonly AnimalSim[], host: SimHost) => DeclaredHerdRecipe;
}
/** Pure preparation lets a loader preflight its other controllers before initialization and callback registration. */
export interface PreparedGroupBrains {
  readonly policies: ReadonlyMap<string, DeclaredGroupPolicy>;
  install: (restoring?: boolean) => ReadonlyMap<string, DeclaredGroupPolicy>;
}
interface Registration {
  id: string; members: AnimalSim[]; policy: DeclaredGroupPolicy;
  random: () => Rng; run: (dt: number) => void;
}
const commonFunctions = ['sharedRng', 'environment', 'visibility', 'hearing', 'downwind', 'inBounds', 'normalY'] as const;
function functionsPresent(values: readonly unknown[]): void {
  if (values.some(value => typeof value !== 'function')) throw new Error('Missing declared group recipe');
}
function available(host: SimHost, registrations: readonly Registration[]): void {
  for (const row of registrations) {
    if (host.hasStep(row.id) || host.adapters.has(row.id) || row.members.some(actor => host.entities.get(actor.entityId) !== actor
      || host.hasStep(`brain.${actor.entityId}`) || host.adapters.has(`brain.${actor.entityId}`))) throw new Error('Installed or changed group controller');
  }
}
function prepareRegistration(host: SimHost, group: ShardPackGroup | ShardHerdGroup, members: AnimalSim[], ports: DeclaredGroupPorts): Registration {
    const id = `group.${group.id}`;
    if (group.kind === 'pack') {
      if (ports.pack === undefined) throw new Error('Missing declared group port');
      const recipe = ports.pack(group, members, host);
      functionsPresent([...commonFunctions.map(key => recipe.ports[key]), recipe.ports.register, recipe.ports.bite,
        recipe.ports.preyIdentity, recipe.ports.resolvePrey, recipe.observe, recipe.confine]);
      const policyForGroup = new PackBrain(members, group.home[0], group.home[1], group, recipe.ports);
      return { id, members, policy: policyForGroup, random: recipe.ports.sharedRng, run: dt => {
        if (host.state.tick % group.thinkDivisor === 0) for (const actor of members) if (actor.alive) {
          const context = { ...recipe.observe(actor, group.thinkDivisor / 60), dt: group.thinkDivisor / 60, t: host.clock.now };
          policyForGroup.tick(context); policyForGroup.drive(actor, context); recipe.confine(actor);
        }
        for (const actor of members) if (actor.alive) {
          policyForGroup.drive(actor, { ...recipe.observe(actor, dt), dt, t: host.clock.now }, true); recipe.confine(actor);
        }
      } };
    }
    {
      if (ports.herd === undefined) throw new Error('Missing declared group port');
      const recipe = ports.herd(group, members, host);
      functionsPresent([...commonFunctions.map(key => recipe.ports[key]), recipe.ports.passThrough, recipe.ports.chargeContact,
        recipe.ports.scarePack, recipe.ports.resolveActor, recipe.observe]);
      const policyForGroup = new HerdBrain(members, group, recipe.ports);
      policyForGroup.onTamed = (body, x, z) => { host.events.emit('creature.tamed', { kind: body.kind, variant: body.variant, herd: body.herd, x, z, id: body.entityId }); };
      return { id, members, policy: policyForGroup, random: recipe.ports.sharedRng, run: dt => {
        if (host.state.tick % group.thinkDivisor === 0) for (const actor of members) if (actor.alive) {
          const context = { ...recipe.observe(actor, group.thinkDivisor / 60), dt: group.thinkDivisor / 60, t: host.clock.now };
          policyForGroup.tick(context); policyForGroup.drive(actor, context);
        }
        for (const actor of members) if (actor.alive) policyForGroup.drive(actor, { ...recipe.observe(actor, dt), dt, t: host.clock.now }, true);
      } };
    }
}
/** Validate every roster and recipe without draws, memory writes or registration. Install after all controller preflight; restore skips setup. */
export function prepareDeclaredGroupBrains(host: SimHost, declarations: readonly ShardGroupBrain[],
  spawns: readonly { id: string; brain: string | null }[], ports: DeclaredGroupPorts,
  individualIds: readonly string[] = [], encounterIds: readonly string[] = []): PreparedGroupBrains {
  const groups = declarations.map(nativeGroupBrain);
  if (new Set(spawns.map(row => row.id)).size !== spawns.length || groupBrainRules(groups, spawns, individualIds, encounterIds).length > 0) throw new Error('Invalid group controller roster');
  for (const group of groups) {
    if (host.hasStep(`group.${group.id}`) || host.adapters.has(`group.${group.id}`) || group.members.some(id => host.players.has(id) || host.entities.get(id)?.entityId !== id
      || host.hasStep(`brain.${id}`) || host.adapters.has(`brain.${id}`))) throw new Error('Unresolved or installed group actor');
    if ((group.kind === 'pack' && ports.pack === undefined) || (group.kind === 'herd' && ports.herd === undefined)) throw new Error('Missing declared group port');
  }
  const registrations: Registration[] = [], policies = new Map<string, DeclaredGroupPolicy>();
  for (const group of groups) {
    const members = group.members.map(id => {
      const actor = host.entities.get(id);
      if (actor === undefined) throw new Error('Unresolved group actor');
      return actor;
    });
    const registration = prepareRegistration(host, group, members, ports);
    registrations.push(registration); policies.set(group.id, registration.policy);
  }
  available(host, registrations);
  let installed = false;
  return { policies, install: (restoring = false) => {
    if (installed) throw new Error('Group controllers already installed');
    available(host, registrations);
    const memories = registrations.flatMap(row => row.members.map(actor => ({ actor, memory: { ...actor.mem } })));
    const states = registrations.map(row => row.policy.snapshot()), streams = host.rng.snapshot();
    const random = new Map<Rng, RngState>(), remove: (() => void)[] = [];
    try {
      if (!restoring) for (const row of registrations) {
        const rng = row.random(); if (!random.has(rng)) random.set(rng, rng.snapshot());
        row.policy.initialize();
      }
      for (const row of registrations) remove.push(host.onStep(row.id, row.run, {
        snapshot: () => row.policy.snapshot(), restore: saved => {
          if (typeof saved !== 'string') throw new Error('Invalid group continuation');
          row.policy.restore(saved);
        },
      }));
      installed = true; return policies;
    } catch (error) {
      for (const undo of remove) undo();
      for (const { actor, memory } of memories) { for (const key of Object.keys(actor.mem)) delete actor.mem[key]; Object.assign(actor.mem, memory); }
      for (const [rng, state] of random) rng.restore(state);
      host.rng.restore(streams);
      for (const [index, row] of registrations.entries()) { const state = states[index]; if (state !== undefined) row.policy.restore(state); }
      throw error;
    }
  } };
}

/** G600 L5: the nearest live body in an ordered roster within `radius` (ties keep source order); page and native groups. */
export function nearestPopulationActor<A extends AnimalSim>(bodies: readonly A[], x: number, z: number, radius: number): A | null {
  let selected: A | null = null, distance = radius;
  for (const body of bodies) if (body.alive) { const next = Math.hypot(body.position.x-x,body.position.z-z); if (next < distance) { distance = next; selected = body; } }
  return selected;
}
/** G600 L5: the senses ports a pack and a herd share, over one owner's senses, random stream, bounds and ground normal. */
export interface SharedGroupPorts<E> {
  readonly sharedRng: () => Rng; readonly environment: () => E;
  readonly visibility: (x: number, z: number, player: Vector3, speed: number, time: number) => number;
  readonly hearing: (radii: readonly [number, number, number, number], player: Vector3, speed: number) => number;
  readonly downwind: (x: number, z: number, player: Vector3) => boolean;
  readonly inBounds: (x: number, z: number, margin?: number) => boolean; readonly normalY: (x: number, z: number) => number;
  /** the standing (untrampled) grass height: a herd's guest keeps its graze spots and flights in cover (QB19) */
  readonly grassHeightAt: (x: number, z: number) => number;
  readonly onEvent: (name: string, x: number, z: number) => void;
}
export function sharedGroupPorts<E extends WildSenses & { onEvent: (name: string, x: number, z: number) => void }>(environment: E,
  world: { readonly rng: () => Rng; readonly inBounds: (x: number, z: number, margin: number) => boolean; readonly normalY: (x: number, z: number) => number }): SharedGroupPorts<E> {
  return { sharedRng: world.rng, environment: () => environment,
    visibility: (x: number,z: number,player: Vector3,speed: number,time: number) => environment.visibility(x,z,player,speed,time),
    hearing: (radii: readonly [number,number,number,number],player: Vector3,speed: number) => environment.hearing(radii,player,speed),
    downwind: (x: number,z: number,player: Vector3) => environment.downwind(x,z,player),
    inBounds: (x: number,z: number,margin = 0) => world.inBounds(x,z,margin), normalY: world.normalY,
    grassHeightAt: (x: number,z: number) => environment.grassStandingAt(x,z),
    onEvent: (name: string,x: number,z: number) => { environment.onEvent(name,x,z); } };
}
/** G600 L5: a group's bite / charge contact from its declared strike rows, with the context's own reach and hurt authority. */
export function groupContact(rows: { readonly pack: Parameters<typeof strikeFromData>[0]; readonly herd: Parameters<typeof strikeFromData>[0] }): (body: AnimalSim, context: { player: Vector3 }, radius: number, herd: boolean) => void {
  const strikes = new StrikeRunner(), packStrike = strikeFromData(rows.pack), herdStrike = strikeFromData(rows.herd);
  interface Contact { player: Vector3; reach: (body: AnimalSim) => boolean; hurt: (damage: number) => void }
  const hasContact = (context: { player: Vector3 }): context is Contact => 'reach' in context && typeof context.reach === 'function' && 'hurt' in context && typeof context.hurt === 'function';
  return (body, context, radius, herd) => {
    if (!hasContact(context)) throw new Error('Missing group contact authority');
    const { reach, hurt } = context;
    strikes.contact({ ...herd ? herdStrike : packStrike, shape: { kind: 'point', radius, exclusive: true } }, {
      actor: body, target: context.player, canReach: () => reach(body), hit: () => { hurt(body.mods.chargeDamage); } });
  };
}

type GroupGuestRow=NonNullable<Extract<v.InferOutput<typeof NativeGroupRowsSchema>['steps'][number],{kind:'group'}>['guest']>;
interface GroupLifecycle<Owner> {
  bindGuest:(program:GroupGuestProjectionV2,input:unknown,loans:Owner)=>void;
  initialize:()=>void;
}
/** Complete the original concrete controller's construction transaction.
 * Programme lookup follows its constructor; binding precedes initialization.
 * The caller retains native/page ports, ordered bodies and membership maps. */
export function initializeDeclaredGroup<Owner extends {readonly scope:Scope}>(controller:GroupLifecycle<Owner>,guest:GroupGuestRow|undefined,owners:Owner|undefined,host?:SimHost):void {
  if(guest!==undefined){
    if(owners===undefined||host!==undefined&&host.scope!==owners.scope)throw new Error('Group guest requires its original world owner');
    const program=host===undefined?ReturnProgram.page(guest.program,owners.scope):ReturnProgram.native(host,guest.program);
    if(program.prepareGroup===undefined||program.groupBindings===undefined)throw new Error('Missing group capability');
    controller.bindGuest({groupBindings:program.groupBindings,prepareGroup:program.prepareGroup},guest.binding,owners);
  }
  controller.initialize();
}

const collections = new WeakMap<SimHost, Map<string, NativeGroupCollection>>();
/** Resolve the admitted herd controllers and their live numeric wind together. */
export function nativeHerdCollection(host: SimHost, id: string): { herds: readonly HerdBrain<AnimalSim>[]; wind: { x: number; z: number; strength: number } } {
  const rows = [...(collections.get(host)?.values() ?? [])].find(owner => owner.herdService === id); if (rows === undefined) throw new Error('Missing native herd collection'); return rows;
}

/** Existing native group service, resolved by stable data id. */
export function nativeGroupCollection(host: SimHost, id: string): NativeGroupCollection {
  const owner = collections.get(host)?.get(id); if (owner === undefined) throw new Error('Missing native group collection'); return owner;
}
/** Native identity books and actual group owners. Deferred membership and crowd
 * prey use these same maps, never a shard resolver or pack-factory callback. */
export class NativeGroupCollection {
  private preyRows: PackPrey[][] = [];
  readonly environment: NativeWildEnvironment | undefined;
  readonly herdService: string | undefined;
  readonly wind: NativeWildEnvironment['wind'];
  constructor(private readonly host: SimHost, readonly packs: PackBrain<AnimalSim>[], readonly herds: HerdBrain<AnimalSim>[],
    private readonly actors: Map<string, AnimalSim>, private readonly prey: Map<string, PackPrey>, private readonly ids: WeakMap<PackPrey, string>,
    private readonly wolves: AnimalSim[], private readonly packOf: WeakMap<AnimalSim, PackBrain<AnimalSim>>,
    rows: { id: string; firstRaid: number; environment?: NativeWildEnvironment; herds?: string },
    readonly tokens?: { id: string; owners: WeakMap<AnimalSim, Parameters<PackPorts<AnimalSim>['register']>[1]> }) {
    const map = collections.get(host) ?? new Map<string, NativeGroupCollection>();
    if (rows.environment !== undefined && !(rows.environment instanceof NativeWildEnvironment)) throw new Error('Invalid native group world');
    if (map.has(rows.id) || packs.length === 0 || packs.length > 8 || herds.length > 8 || packs.some(pack => !(pack instanceof PackBrain))
      || herds.some(herd => !(herd instanceof HerdBrain)) || [...actors.values()].some(actor => host.entities.get(actor.entityId) !== actor)) throw new Error('Invalid native group owners');
    if (rows.herds !== undefined && [...map.values()].some(owner => owner.herdService === rows.herds)) throw new Error('Invalid native herd collection');
    if (tokens !== undefined && [...map.values()].some(owner => owner.tokens?.id === tokens.id)) throw new Error('Duplicate native manager token owners');
    map.set(rows.id, this); collections.set(host, map); host.scope.onDispose(() => { map.delete(rows.id); }); this.firstRaid = rows.firstRaid; this.environment = rows.environment;
    this.herdService = rows.herds; this.wind = rows.environment?.wind ?? { x: 0, z: 0, strength: 0 };
  }
  /** Membership and lifetime check over the concrete group, without importing its class value. */
  owns(host: SimHost): boolean { return this.host === host && !host.scope.disposed && !host.scope.disposing && [...collections.get(host)?.values() ?? []].includes(this); }
  readonly firstRaid: number;
  addPack(members: AnimalSim[], x: number, z: number): PackBrain<AnimalSim> {
    const source = this.packs[0]; if (source === undefined || this.packs.length >= 8 || members.length > 64 || members.some(actor => this.host.entities.get(actor.entityId) !== actor)) throw new Error('Invalid deferred native pack');
    for (const actor of members) { this.actors.set(actor.entityId, actor); this.ids.set(actor, `actor:${actor.entityId}`); this.wolves.push(actor); }
    const pack = source.sibling(members, x, z);
    pack.findPrey = (px, pz, radius) => nearestPopulationActor(this.herds.flatMap(herd => herd.foals), px, pz, radius);
    this.packs.push(pack); for (const actor of members) this.packOf.set(actor, pack); return pack;
  }
  bindFlocks(flocks: readonly FlockBrain[], prefix: string): readonly (readonly PackPrey[])[] {
    if (this.preyRows.length > 0 || flocks.length > 4) throw new Error('Invalid native flock binding');
    this.preyRows = flocks.map((flock, index) => Array.from({ length: flock.n }, (_, at) => {
      const position = new Vector3(), id = `${prefix}${String(index)}:${String(at)}`;
      if (this.prey.has(id)) throw new Error('Duplicate native flock prey');
      const prey = { get position() { return flock.positions(at, position); }, get yaw() { return flock.headingOf(at); }, get alive() { return flock.isAlive(at); },
        applyDamage: (): boolean => { flock.kill(at); return true; } };
      this.prey.set(id, prey); this.ids.set(prey, id); return prey;
    })); return this.preyRows;
  }
}

/** G474 native group setup from admitted rows and concrete world owners. No
 * shard contact, perception, identity or controller-factory port is accepted. */
export function installNativeGroupRows(host: SimHost, input: unknown, grid: BakedGrid, environment: NativeWildEnvironment): NativeGroupCollection {
  const rows = v.parse(NativeGroupRowsSchema, input), sample = bakedSamplers(grid);
  if (!(environment instanceof NativeWildEnvironment) || collections.get(host)?.has(rows.id)) throw new Error('Invalid or installed group world');
  const actor = (id: string): AnimalSim => { const body = host.entities.get(id); if (body === undefined) throw new Error(`Missing group actor ${id}`); return body; };
  const declarations = rows.steps.flatMap(step => step.kind === 'group' ? [{ row: nativeGroupBrain(step.row), adopt: step.adopt }] : []);
  const members = declarations.flatMap(({ row, adopt }) => [...row.members, ...adopt === null ? [] : [adopt]]);
  if (new Set(members).size !== members.length || declarations.filter(({ row }) => row.kind === 'pack').length === 0
    || declarations.filter(({ row }) => row.kind === 'pack').length > 8 || declarations.filter(({ row }) => row.kind === 'herd').length > 8
    || declarations.some(({ row, adopt }) => row.kind === 'pack' && adopt !== null)) throw new Error('Invalid native group roster');
  for (const id of [...members, ...rows.owned]) actor(id);
  const actors = new Map(members.map(id => [id,actor(id)])), prey = new Map<string,PackPrey>(), ids = new WeakMap<PackPrey,string>();
  for (const [id,body] of actors) ids.set(body, `actor:${id}`);
  const packs: PackBrain<AnimalSim>[] = [], herds: HerdBrain<AnimalSim>[] = [], wolves: AnimalSim[] = [];
  const packOf = new WeakMap<AnimalSim,PackBrain<AnimalSim>>(), tokens = new WeakMap<AnimalSim,Parameters<PackPorts<AnimalSim>['register']>[1]>();
  const shared = sharedGroupPorts(environment, { rng: () => host.rng.stream('ai'), normalY: (x, z) => sample.normalAt(x,z)[1],
    inBounds: (x, z, margin) => x >= rows.bounds[0]+margin && x <= rows.bounds[1]-margin && z >= rows.bounds[2]+margin && z <= rows.bounds[3]-margin });
  const contact = groupContact(rows.contacts);
  let firstRaid = 0;
  for (const id of rows.owned) actor(id).mem['owned'] = 1;
  for (const step of rows.steps) {
    if (step.kind === 'delay') { firstRaid = v.parse(v.number(), ReturnProgram.native(host,step.program).project(step.signal,{},host.rng.stream('ai'))[step.channel]); continue; }
    const row = nativeGroupBrain(step.row), bodies = row.members.map(actor);
    if (row.kind === 'pack') {
      const pack = new PackBrain(bodies,row.home[0],row.home[1],row,{ ...shared,
        register: (body,director) => { tokens.set(body,director); }, bite: (body,context,radius) => { contact(body,context,radius,false); },
        preyIdentity: target => { const id = ids.get(target); if (id === undefined) throw new Error('Missing native prey identity'); return id; },
        resolvePrey: id => id.startsWith('actor:') ? actors.get(id.slice(6)) ?? null : prey.get(id) ?? null });
      initializeDeclaredGroup(pack,step.guest,{scope:host.scope,group:`${rows.id}:pack.${packs.length}`,
        handle:100+packs.length,roster:()=>herds.flatMap(herd=>herd.foals)},host);
      pack.findPrey = (x,z,radius) => nearestPopulationActor(herds.flatMap(herd => herd.foals),x,z,radius);
      packs.push(pack); wolves.push(...bodies); for (const body of bodies) packOf.set(body,pack);
    } else {
      const herd = new HerdBrain(bodies,row,{ ...shared, resolveActor: id => actors.get(id) ?? null,
        passThrough: (body,through) => { if (body.motor instanceof CharacterMotor) body.motor.passThrough(through ? ['PLAYER'] : []); },
        chargeContact: (body,context,radius) => { contact(body,context,radius,true); },
        scarePack: (body,radius) => { const pack = packOf.get(body); if (pack === undefined) return false; pack.scare(body.position.x,body.position.z,radius); return true; },
        onKnockdown: (x,z,strength) => { environment.onKnockdown(x,z,strength); } });
      herd.onTamed = (body,x,z) => { host.events.emit('creature.tamed',{ kind:body.kind,variant:body.variant,herd:body.herd,x,z,id:body.entityId }); };
      initializeDeclaredGroup(herd,step.guest,{scope:host.scope,group:row.id,handle:herds.length+1,
        player:host.playerFocus,actors:host.entities},host);
      herd.findThreat = (x,z,radius) => nearestPopulationActor(wolves,x,z,radius);
      if (step.adopt !== null) herd.adoptStallion(actor(step.adopt)); herds.push(herd);
    }
  }
  const collection = new NativeGroupCollection(host,packs,herds,actors,prey,ids,wolves,packOf,{ id: rows.id,firstRaid,environment,herds: rows.herds },{ id: rows.tokens,owners: tokens });
  return collection;
}
