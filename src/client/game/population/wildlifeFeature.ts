import { macrotask } from '@wildshard/engine/boot/plan';
import { buildYield } from '@wildshard/engine/core/workSlice';
import { wind } from '@wildshard/engine/world/steppeWind';
import { installPopulationSignals } from './signals';
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import type { RayTargets } from '@wildshard/engine/combat/targets';
import type { SpeciesActorsFileRows } from '@wildshard/format/speciesBookRows';
import { WildlifePopulationSchema } from '@wildshard/format/wildlifePopulation';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import { Vector3 } from 'three';
import * as v from 'valibot';
import type { Scope } from '@wildshard/engine/app/scope';
import { pageApp } from '@wildshard/engine/app/pageSeat';
import { ForagerPopulation } from '@wildshard/engine/ai/ambientForager';
import type { HerdBrain } from '@wildshard/engine/ai/herd';
import type { PackBrain } from '@wildshard/engine/ai/pack';
import type { TargetHit } from '@wildshard/engine/combat/types';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import { ProjectedMotionSample, ReturnProgram } from '../../../shared/game/population/returnProgram';
import { adoptClientWildlife, clientWildlifeLent, retireClientWildlife } from '../../../shared/game/population/wildlifeOwner';
import { pageRidingMounted } from '../../../shared/game/riding/entered';
import { lendRidingPopulation } from '../../../shared/game/riding/pagePopulation';
import { installEnteredService } from '../../../shared/game/shard/enteredServices';
import { CrowdRoster, CrowdTargets, CrowdWeaponTarget, installDeclaredCrowdFrames } from '../../../shared/game/shardfile/crowdRuntime';
import type { CrowdDraw } from '../ambient/crowdDraw';
import { prepareForagerDraw, type ForagerDraw } from '../ambient/foragerDraw';
import { createPageCrowds } from '../ambient/pageCrowds';
import { fixedDraws } from '../models/fixedDraws';
import type { ShardContext } from '../plugin/context';
import { pageAir } from './pageAir';

type Rows = v.InferOutput<typeof WildlifePopulationSchema>;
type BuildStep = { kind: 'pause' } | { kind: 'foragers' } | { kind: 'crowd'; index: number; options: { x: number; z: number; count: number; seed: number; range: number } };
/** What a page keeps of a wild the server runs: the crowds it draws, the foragers underfoot and the row bodies they read.
 * Every pack, herd and mount is a row, so this spawns none and steps no group. */
export class PageWildlifeView<T extends CrowdTargets = CrowdDraw> {
  readonly flocks: T[] = []; readonly predators: Animal[] = []; readonly mountables: readonly Animal[] = [];
  readonly packs: readonly PackBrain<Animal>[] = []; readonly herds: readonly HerdBrain<Animal>[] = [];
  readonly foragers: { readonly rules: ForagerPopulation } | null;
  private readonly rows: Rows; private readonly placement: ReturnProgram;
  private readonly weaponTarget: CrowdWeaponTarget<T>; private readonly motion: ProjectedMotionSample;
  constructor(private readonly animals: RowBodiesView, input: unknown, programmeScope: Scope) {
    this.rows = v.parse(WildlifePopulationSchema, input); const row = this.rows;
    this.placement = ReturnProgram.page(row.admission, programmeScope);
    this.weaponTarget = new CrowdWeaponTarget(new CrowdRoster(animals.animals, this.flocks, row.groups.prey), row.combat);
    this.motion = new ProjectedMotionSample(this.placement, 'speed');
    if (row.foragers === null) this.foragers = null;
    else { const rules = new ForagerPopulation(row.foragers.row, row.foragers.seed); rules.restore(row.foragers.initial); this.foragers = { rules }; }
  }
  *buildSteps(): Generator<BuildStep, void> {
    const row = this.rows;
    // one animal a step: a whole pack or herd was one 100-133 ms task in a cold Nalati crossing at phone 4x
    for (const _model of this.animals.factory.prepareSteps(this.declaredBodies())) yield { kind: 'pause' };
    for (const [index, flock] of row.flocks.entries()) {
      yield { kind: 'crowd', index, options: { x: flock.x, z: flock.z, count: flock.count, seed: row.seed + index * 101, range: flock.range } };
      if (this.flocks.length !== index + 1) throw new Error('Unbound population crowd');
    }
    if (row.mountables.length > 0) yield { kind: 'pause' };
    if (this.foragers !== null) yield { kind: 'foragers' };
  }
  /** Every body this population declares, as rows will bring them. */
  private declaredBodies(): { readonly kind: string; readonly variant: string }[] {
    const row = this.rows, { predator, mount, guardian, guardianVariant } = row.kinds;
    return [...new Set(row.packs.flatMap(pack => pack.variants))].map(variant => ({ kind: predator, variant }))
      .concat([...row.coats, ...row.young, row.leader, ...row.mountables.map(entry => entry.variant)].map(variant => ({ kind: mount, variant })))
      .concat(row.flocks.some(flock => flock.dog) ? [{ kind: guardian, variant: guardianVariant }] : []);
  }
  /** Bind an already-built crowd. */
  attachCrowd(index: number, view: T): void {
    if (!(view instanceof CrowdTargets) || index !== this.flocks.length || this.rows.flocks[index]?.count !== view.n) throw new Error('Invalid population crowd binding');
    this.flocks.push(view);
  }
  /** Observe before advancing declared crowds, without a per-crowd callback. */
  beginFrame(dt: number, player: { position: Vector3; forward: Vector3; crouching: boolean }, extra: { mounted?: boolean }): number {
    const p = player.position, speed = this.motion.update(dt, p.x, p.z), length = Math.hypot(player.forward.x, player.forward.z), wild = pageAir;
    if (length > 1e-4) { wild.playerFwdX = player.forward.x / length; wild.playerFwdZ = player.forward.z / length; }
    const health = pageApp().player?.attributes;
    wild.playerCrouched = player.crouching; wild.playerMounted = extra.mounted ?? false; wild.playerHealth01 = health === undefined ? 1 : health.health / health.maxHealth;
    this.predators.length = 0;
    for (const actor of this.animals.animals) if (actor.kind === this.rows.kinds.predator && actor.alive) this.predators.push(actor);
    const row = this.rows.trample;
    for (const actor of this.animals.animals) {
      const radius = row.kinds[actor.kind];
      if (radius === undefined || !actor.alive || actor.speed < row.minSpeed || (actor.position.x - p.x) ** 2 + (actor.position.z - p.z) ** 2 > row.range ** 2) continue;
      wild.trample(actor.position.x, actor.position.z, radius * actor.scale, Math.min(1, actor.speed / row.fullSpeed), Math.sin(actor.yaw) * actor.speed, Math.cos(actor.yaw) * actor.speed);
    }
    return speed;
  }
  /** The row of this crowd's guardian kind nearest its home. */
  rowGuardian(index: number): Animal | null {
    const row = this.rows.flocks[index];
    if (row?.dog !== true) return null;
    let nearest: Animal | null = null, best = Infinity;
    for (const actor of this.animals.animals) {
      if (actor.kind !== this.rows.kinds.guardian || !actor.alive) continue;
      const away = Math.hypot(actor.position.x - row.x, actor.position.z - row.z);
      if (away < best) { best = away; nearest = actor; }
    }
    return nearest;
  }
  /** Finish after crowd motion; a forager's alarm is a sound the page hears. */
  endFrame(dt: number, player: Vector3, speed: number, crouched: boolean): void {
    const forager = this.rows.foragers;
    if (forager === null || this.foragers === null) return;
    const alarm = this.foragers.rules.update(dt, player, speed > forager.runSpeed, crouched);
    if (alarm !== null) pageApp().events.emit('creature.sound', { cue: forager.cue, x: alarm.x, y: terrainHeight(alarm.x, alarm.z), z: alarm.z });
  }
  /** A shot lands near a crowd this page draws, and the crowd starts. */
  disturb(x: number, z: number): void {
    const { disturbRadius, disturbSeconds } = this.rows.relations;
    this.scareCrowds(x, z, disturbRadius, disturbSeconds);
  }
  /** Lightning near a crowd this page draws. */
  scare(x: number, z: number, radius = 60): void { this.scareCrowds(x, z, radius, this.rows.relations.scareSeconds); pageAir.onEvent('scare', x, z); }
  private scareCrowds(x: number, z: number, radius: number, seconds: number): void {
    for (const view of this.flocks) if (this.placement.project(this.rows.relations.range, { x, z, px: view.cx, pz: view.cz, radius })['accept'] === 1) view.scare(x, z, seconds);
  }
  /** The weapon target over the crowds this page draws. */
  raycastWeapon(origin: Vector3, direction: Vector3, maximum: number, previous: TargetHit | null): TargetHit | null { return this.weaponTarget.raycast(origin, direction, maximum, previous); }
}

/** Client-only lifecycle adapter for the existing population host. Admitted
 * files select geometry and population rows; native owners retain all clocks. */
export async function installClientWildlife(ctx: ShardContext, feature: ClientFeatureRow): Promise<void> {
  if (feature.kind !== 'population.wildlife' || ctx.scope.disposed || clientWildlifeLent(ctx.scope)) throw new Error('Invalid wildlife feature owner');
  const runtime = ctx.game.runtime, world = runtime?.world;
  if (runtime === undefined || world === undefined || world === null || runtime.hooks.animalsBuilt !== undefined) throw new Error('Wildlife requires its unbound world animal stage');
  const rows = v.parse(WildlifePopulationSchema, await ctx.product.json(feature.file));
  // Resolve the named wet loan before publishing any entered population owner.
  const wet=rows.groups.world.wet,wetFile=typeof wet==='string'||typeof wet.data==='string'?undefined:wet.data.file;
  if (ctx.scope.disposed || ctx.scope.disposing || ctx.game.runtime !== runtime || runtime.world !== world) throw new Error('Wildlife owner left during wet preparation');
  const wetBlock=wetFile===undefined?undefined:{file:wetFile,bytes:await ctx.product.file(wetFile)};
  if (ctx.scope.disposed || ctx.scope.disposing || ctx.game.runtime !== runtime || runtime.world !== world) throw new Error('Wildlife owner left during wet preparation');
  // The one programme this population consumes: placement's, on the level.
  if (ReturnProgram.prepareMemory(rows.admission, world.game.levelScope)) await buildYield(world.game.levelScope);
  if (ctx.scope.disposed || ctx.scope.disposing || ctx.game.runtime !== runtime || runtime.world !== world) throw new Error('Wildlife owner left during memory preparation');
  installEnteredService(ctx, scope => { pageAir.enter(scope, rows.groups, wetBlock); installPopulationSignals(ctx,scope,rows.groups.effects); });
  const page = await ctx.product.json<SpeciesActorsFileRows>(feature.crowd.json);
  if (page.parts.length === 0 || page.parts.length !== page.pivots.length || page.radius <= 0 || page.draws.length !== 1) throw new Error('Invalid crowd body joints or bound');
  const draws = fixedDraws(ctx.product, page.draws), template = draws.handle(feature.crowd.binary);
  const closed = (): boolean => ctx.scope.disposed || ctx.scope.disposing;
  await draws.load();
  const geometry = template.take();
  if (closed() || geometry.boundingSphere === null) { geometry.dispose(); throw new Error('Crowd geometry owner left or bounds are missing'); }
  ctx.scope.own(geometry);
  // The original animated sphere includes moving limbs; fixedDraws stays static.
  geometry.boundingSphere.radius = page.radius;
  const body = { geometry, pivots: page.pivots, parts: page.parts };
  const predators: Animal[] = [], crowds = createPageCrowds(world.sky, world.chunk.seed, body, page.page.world, predators);
  const foragers = rows.foragers?.view === undefined ? null : await prepareForagerDraw(ctx, rows);
  const owner: { wildlife: PageWildlifeView | null } = { wildlife: null };
  let draw: ForagerDraw | null = null;
  adoptClientWildlife(ctx.scope, owner);
  lendRidingPopulation(ctx.scope, () => {
    const population = owner.wildlife, wild = pageAir;
    return population === null ? null : { herds: population.herds, mountables: population.mountables, predators: population.predators, wind: wild.wind,
      wetAt: (x, z) => wild.wetAt(x, z), rider: mounted => { wild.playerMounted = mounted; } };
  });
  // Registered at feature install, before later state reducers. The same
  // mutable owner is empty until animalsBuilt and retires with this scope.
  ctx.answer('combat.targets.ray',(request:RayTargets):RayTargets=>({...request,
    hit:owner.wildlife===null?request.hit:owner.wildlife.raycastWeapon(request.origin,request.dir,request.maxDist,request.hit)}));
  let started = false;
  const ensureActive = (): void => { if (ctx.scope.disposed) throw new Error('Wildlife owner left during construction'); };
  const build = async (animals: RowBodiesView): Promise<void> => {
    if (ctx.scope.disposed || started) throw new Error('Wildlife animal stage is unavailable');
    started = true;
    animals.wetAt = (x, z) => pageAir.wetAt(x, z);
    const population = new PageWildlifeView(animals, rows, world.game.levelScope);
    // the population's admission and its first pack take a task each: together they were one 117 ms afterKit frame of a
    // cold Nalati crossing at phone 4x (~32 ms admitting its programmes, ~59 ms the first pack)
    await macrotask(); ensureActive();
    for (const step of population.buildSteps()) {
      ensureActive();
      if (step.kind === 'crowd') {
        const view = crowds.factory(step.options, step.index); world.game.scene.add(view.mesh);
        population.attachCrowd(step.index, view);
      } else if (step.kind === 'foragers' && population.foragers !== null && foragers !== null) {
        draw = foragers.create(population.foragers.rules); world.game.scene.add(draw.mesh);
      }
      await macrotask();
    }
    await macrotask();
    ensureActive();
    owner.wildlife = population;
  };
  runtime.hooks.animalsBuilt = build;
  ctx.scope.onDispose(() => { retireClientWildlife(ctx.scope); if (runtime.hooks.animalsBuilt === build) delete runtime.hooks.animalsBuilt; });
  const player = { position: world.player.position, forward: new Vector3(0, 0, -1), crouching: false };
  const extra = { mounted: false };
  installDeclaredCrowdFrames(ctx, { systemId: feature.frame.id, after: feature.frame.after, before: feature.frame.before,
    current: () => owner.wildlife === null ? null : crowds.runtime,
    frame: (dt, time, advance) => {
      const population = owner.wildlife; if (population === null) return;
      player.forward.set(-Math.sin(world.player.yaw), 0, -Math.cos(world.player.yaw)); player.crouching = world.player.crouching;
      extra.mounted = pageRidingMounted(ctx);
      const env = pageAir; env.wind.x = wind.dirX; env.wind.z = wind.dirZ; env.wind.strength = Math.min(1, wind.speed / 10);
      const speed = population.beginFrame(dt, player, extra);
      predators.length = 0;
      for (let index = 0; index < 64; index++) { const actor = population.predators[index]; if (actor === undefined) break; predators.push(actor); }
      for (const [index, view] of population.flocks.entries()) {
        view.dog = population.rowGuardian(index);
        crowds.advance(view, index, speed, player.position, dt, time, advance);
      }
      population.endFrame(dt, player.position, speed, player.crouching); draw?.project();
    } });
}
