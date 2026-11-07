// Frozen before the native driver adopted StalkerBrain.bindRoster.
import type { NativeGroupCollection } from '../../src/server/game/shardfile/groupRuntime';
import { ActorProjectionV2, type ActorProjectionOwner } from '../../src/server/game/population/actorProjectionV2';
import { NativeManager } from '../../src/server/game/population/nativeManager';
import { AggressionDirector } from '../../src/shared/engine/ai/director';
import { Vector3 } from 'three';
import type { PackBrain } from '../../src/server/engine/ai/pack';
import type { HerdBrain } from '../../src/server/engine/ai/herd';
import type { FlockBrain, FlockThreat } from '../../src/shared/engine/ai/flock';
import { canReach } from '../../src/shared/engine/ai/reach';
import { createNativeSpeciesContext } from '../../src/server/game/plugin/brain';
import type { NativeEliteBindings } from '../../src/server/engine/ai/eliteRoster';
import { ReturnProgram } from '../../src/shared/game/population/returnProgram';
import type { AnimalSim } from '../../src/shared/engine/entities/AnimalSim';
import type { HuntBody } from '../../src/server/engine/ai/hunt';
import type { StalkerBrain } from '../../src/shared/engine/ai/stalker';
import type { Rng } from '../../src/shared/engine/core/rng';
import type { SimHost } from '../../src/server/engine/sim';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
export interface NativeDriverRows {
  tokens: string; program: unknown; packKind: string; dogKind: string; eliteKinds: readonly string[]; dispatch: string; projection?:unknown;
}
/** Manager decisions and native body continuation. Contexts allocate only when
 * a concrete actor joins; restored and newly bonded actors keep the same owner. */
export class OriginalNativePopulationDriver {
  private readonly contexts = new WeakMap<HuntBody, ReturnType<typeof this.makeContext>>();
  private readonly author: ReturnProgram;
  private readonly tokens: WeakMap<AnimalSim, AggressionDirector<AnimalSim>>;
  private readonly sheep = new Vector3();
  private readonly projection:ActorProjectionV2|undefined;
  private readonly route = { elite: 0, wolf: 0, dog: 0, held: 0 };
  private readonly missing = new Error('Missing native population context');
  private dodgeCd = 0;
  constructor(private readonly host: SimHost, private readonly manager: NativeManager, private readonly hunt: StalkerBrain<HuntBody>, private readonly rng: Rng,
    private readonly bodies: HuntBody[], private readonly packs: ReadonlyMap<AnimalSim, PackBrain<AnimalSim>>,
    private readonly herds: ReadonlyMap<AnimalSim, HerdBrain<AnimalSim>>, private readonly elites: NativeEliteBindings,
    private readonly flocks: readonly FlockBrain[], private readonly wolves: readonly FlockThreat[], private readonly rows: NativeDriverRows, groups: NativeGroupCollection) {
    const tokens = groups.tokens; if (!groups.owns(host) || tokens === undefined || tokens.id !== rows.tokens || !(tokens.owners instanceof WeakMap)) throw new Error('Missing native manager tokens'); this.tokens = tokens.owners;
    if (bodies.length > 64 || flocks.length > 4) throw new Error('Native population driver capacity exceeded');
    this.author = ReturnProgram.native(host, rows.program);
    this.projection=rows.projection===undefined?undefined:new ActorProjectionV2(rows.dogKind,{program:rows.program,step:rows.projection});
    for (const actor of bodies) this.admit(actor);
    host.useBodyStep({ before: (_id, body, dt) => {
      const actor = this.bodies.find(candidate => candidate === body); if (actor === undefined || actor.hidden || !actor.alive || actor.stunned || actor.kind === rows.dogKind) return;
      const elite = elites.brains.get(actor);
      if (elite !== undefined) elite.act(actor);
      else if (actor.kind === rows.packKind) { const pack = packs.get(actor); if (pack !== undefined) { const c = this.context(actor, dt); pack.drive(actor, c, true); c.confine(actor); } }
      else { const herd = herds.get(actor); if (herd !== undefined) herd.drive(actor, this.context(actor, dt), true); }
    }, after: (_id, body) => {
      const actor = this.bodies.find(candidate => candidate === body); if (actor?.alive === true && !actor.hidden && !actor.stunned && actor.state === 'charge') hunt.chargeContact(actor, leadPlayer(host).position);
    } });
  }
  private required(actor: AnimalSim): HuntBody { const body = this.bodies.find(candidate => candidate === actor); if (body === undefined) throw this.missing; return body; }
  private makeContext(actor: HuntBody) {
    const { observation } = createNativeSpeciesContext({ host: this.host, hunt: this.hunt, rng: this.rng,
      world: null, heightAt: (x, z) => this.host.groundHeightAt(x, z), waterLevel: 0 }, actor, null);
    const projection:{owner?:ActorProjectionOwner}={};
    return { ...observation, projection, claim: (a: AnimalSim): boolean => {
      const director = this.tokens.get(a); if (director !== undefined && !(director instanceof AggressionDirector)) throw this.missing; return director?.take(a) ?? true;
    }, pathYaw: (a: AnimalSim, x: number, z: number, every = 1): number => this.hunt.pathYawFor(this.required(a), x, z, every),
      steer: (a: AnimalSim, yaw: number, speed: number, turn: number): void => { this.hunt.steerAny(this.required(a), yaw, speed, turn); },
      confine: (a: AnimalSim): void => { this.hunt.confine(this.required(a)); }, reach: (a: AnimalSim): boolean => canReach(a, leadPlayer(this.host).position, this.host.physics) };
  }
  admit(actor: HuntBody): void {
    if (this.host.entities.get(actor.entityId) !== actor || this.contexts.has(actor)) throw new Error('Invalid native driver actor');
    this.contexts.set(actor, this.makeContext(actor));
  }
  private context(actor: HuntBody, dt: number) {
    const context = this.contexts.get(actor); if (context === undefined) throw this.missing;
    context.dt = dt; context.t = this.host.clock.now; context.playerSpeed = this.manager.noise.speed;
    context.herd = actor.herd >= 0 ? this.hunt.herds[actor.herd]?.members ?? null : null; return context;
  }
  private dog(actor: HuntBody, dt: number): void {
    const flock = this.flocks.find(row => row.dog === actor);
    if (flock === undefined) { actor.setMotion(actor.yaw, 0, 1); return; }
    if(this.projection===undefined)throw new Error('Missing native crowd projection rows');
    actor.mem['dogThinkAt']=this.host.clock.now;
    const context=this.context(actor,dt);
    if(context.projection.owner?.crowd?.owner!==flock)context.projection.owner={scope:this.host.scope,group:'crowd.guard',slot:0,identity:actor.entityId,random:this.host.rng.stream('ai'),
      crowd:{owner:flock,point:this.sheep},rosters:new Map([['threats',this.wolves]])};
    this.projection.step(actor,context,context.projection.owner);
  }

  private decide(actor: HuntBody, dt: number): void {
    const elite = this.elites.brains.get(actor);
    if (!actor.alive) { actor.lookWeight = 0; return; }
    if (this.rows.eliteKinds.includes(actor.kind) && elite === undefined) throw this.missing;
    if (actor.stunned) { actor.setMotion(actor.yaw, 0, 1); actor.setStrafe(0); actor.lookTarget.copy(leadPlayer(this.host).position); actor.lookWeight = 1; return; }
    Object.assign(this.route, { elite: Number(elite !== undefined), wolf: Number(actor.kind === this.rows.packKind), dog: Number(actor.kind === this.rows.dogKind), held: Number(actor.mem['ridden'] === 1 || actor.mem['owned'] === 1) });
    const route = this.author.project(this.rows.dispatch, this.route)['state'];
    if (route === 0) return;
    const context = this.context(actor, dt);
    if (route === 1) elite?.think(actor, context);
    else if (route === 2) { const pack = this.packs.get(actor); if (pack === undefined) actor.setMotion(actor.yaw, 0, 1); else { pack.tick(context); pack.drive(actor, context); context.confine(actor); } }
    else if (route === 3) this.dog(actor, dt);
    else if (route === 4) { const herd = this.herds.get(actor); if (herd === undefined) actor.setMotion(actor.yaw, 0, 1); else { herd.tick(context); herd.drive(actor, context); } }
    const herd = actor.herd >= 0 ? this.hunt.herds[actor.herd] : undefined; if (herd !== undefined) this.hunt.updateHerd(herd);
  }
  private takeStep(actor: HuntBody, urgent: boolean): number {
    const dt = this.host.brainDt(actor.entityId, urgent), last = actor.mem['groupThinkAt'];
    if (dt <= 0 || (last !== undefined && this.host.clock.now-last < .1-1e-9)) return 0;
    actor.mem['groupThinkAt'] = this.host.clock.now; return last === undefined ? dt : this.host.clock.now-last;
  }
  /** Advance after world and riding observations, before the native body phase. */
  update(dt: number): void {
    const player = leadPlayer(this.host).position, speed = this.manager.noise, hunt = this.hunt;
    if (!speed.seen) { speed.prev.set(player.x, 0, player.z); speed.seen = true; }
    const moved = Math.hypot(player.x-speed.prev.x, player.z-speed.prev.z); speed.prev.set(player.x, 0, player.z);
    speed.speed += (Math.min(moved/dt, 9)-speed.speed)*(1-0.5**(dt*10)); this.manager.advance(dt); hunt.resetRepaths();
    const dodged = leadPlayer(this.host).dodge.cd > this.dodgeCd; this.dodgeCd = leadPlayer(this.host).dodge.cd;
    if (dodged) for (const actor of this.bodies) {
      if (!actor.alive || actor.harnessHold || actor.hidden || (!actor.aggressive && !hunt.sensed(actor))) continue;
      const step = this.takeStep(actor, true); if (step > 0) this.decide(actor, step);
    }
    for (let i = 0; i < 64; i++) {
      const actor = this.bodies[i]; if (actor === undefined) break; if (actor.harnessHold || actor.hidden) continue;
      let urgent = false;
      if (actor.alive && actor.aggressive && (actor.state === 'charge' || actor.state === 'stalk' || actor.state === 'alert')) {
        const line = canReach(actor, player, this.host.physics); urgent = this.manager.sight[i] === true && !line; this.manager.sight[i] = line;
      }
      const step = this.takeStep(actor, urgent); if (step > 0) { actor.sampleTerrain(); this.decide(actor, step); }
    }
  }
  snapshot(): number { return this.dodgeCd; }
  restore(value: number): void { if (!Number.isFinite(value) || value < 0) throw this.missing; this.dodgeCd = value; }
}
