/** The night's slot encounter on a host (FLIP-7): statues wake at their phases, walk out as native bodies and go home at dawn, on the same
 *  law, species, poses and colliders the page ran. No command can ask for a wake, a kill or a phase. Which sites stand empty goes out on
 *  a row, and a page draws the rest from each body's own row. */
import * as v from 'valibot';
import { Vector3 } from 'three';
import type { HuntBody } from '@wildshard/engine/ai/hunt';
import type { NativeEliteBindings } from '@wildshard/engine/ai/eliteRoster';
import { landedBy } from '@wildshard/engine/combat/damageBook';
import type { DamageRequest } from '@wildshard/engine/combat/pipeline';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { ObservationColumnsV2 } from '@wildshard/engine/script/observationColumnsV2';
import type { SimHost } from '@wildshard/engine/sim';
import { publishWorldState } from '@wildshard/engine/sim/shardRows';
import { onSimHostRestored } from '@wildshard/engine/sim/snapshot';
import { parseActorProjectionV2 } from '@wildshard/format/actorProjectionV2';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import { EncounterSitesSchema, TimedEncountersSchema } from '@wildshard/format/encounterRows';
import { SceneDressingSchema } from '@wildshard/format/sceneDressing';
import { SpeciesActorsFileSchema } from '@wildshard/format/speciesBookRows';
import { SlotEncounterLaw, slotAwakeRows, type SlotTell } from '../../../shared/game/boss/slotLaw';
import { attachNativeCreaturePose, type NativeCreaturePose } from '../../../shared/game/plugin/animation';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { ActorProjectionV2, type ActorProjectionContext } from '../population/actorProjectionV2';
import { readEncounterIntake, readEncounterPoses } from '../population/encounterBook';
import type { EncounterIntake } from '../population/encounterIntake';
import { nativePopulationOf } from '../riding/nativePopulation';
import { heldArmsOf } from '../weapons/nativeHeld';
import { SlotHeights } from './slotHeights';

const Saved = v.strictObject({ version: v.literal(1), law: v.unknown(), sites: v.array(v.boolean()), poses: v.pipe(v.array(v.tuple([v.string(), v.string()])), v.maxLength(16)), heights: v.exactOptional(v.unknown()) });
const Held = v.object({ slot: v.string(), enabled: v.optional(v.boolean(), true) });
/** How far apart a baked box and its site's numbers may read, in metres: a box is f32. */
const EXACT = 1e-3;
/** Beyond this a body's pose needn't publish a joint a blow could read. */
const POSED_WITHIN = 140;
const noTells = (count: number): SlotTell[] => Array.from({ length: count }, () => ({ hide: () => undefined, wedge: () => undefined }));

/** The rows a slot encounter reads. */
export interface SlotFiles { readonly step: string; readonly rows: string; readonly actors: string; readonly looks: string }
export interface NativeSlots { readonly law: SlotEncounterLaw<HuntBody, SlotTell>; readonly standing: () => readonly boolean[]; readonly solid: (index: number) => Solid;
  /** A body of this kind that another fight raised: it thinks, poses and saves as the slots' own do. */
  readonly adopt: (body: HuntBody) => void }
/** What a blow's player held. */
export type SlotHeld = (request: DamageRequest) => { readonly enabled: boolean; readonly slot: string } | null;
type Solid = ReturnType<SimHost['physics']['world']['getCollider']>;
const owners = new WeakMap<SimHost, NativeSlots>();
export function slotsOf(host: SimHost): NativeSlots | undefined { return owners.get(host); }

/** The slot species' place in the population, when these rows have a slot encounter at all. */
export async function readSlotIntake(product: Pick<ShardFolder, 'json'>, files: Pick<SlotFiles, 'rows' | 'actors'>): Promise<EncounterIntake> {
  const timing = v.parse(TimedEncountersSchema, await product.json<unknown>(files.rows)), kind = timing.slots.actors?.kind;
  return kind === undefined ? { species: [], recipes: [] } : readEncounterIntake(product, [kind], files.actors);
}
function liveContext(input: unknown): input is ActorProjectionContext<HuntBody> {
  if (typeof input !== 'object' || input === null || !('player' in input) || !(input.player instanceof Vector3)) return false;
  return ['dt', 't', 'playerSpeed'].every(key => Number.isFinite(Reflect.get(input, key)));
}

/** What a prepared encounter lends the tick. */
export interface SlotPlan {
  /** A slot's day comes before the patrol's. */
  readonly advance: (host: SimHost, dt: number) => void;
  /** `held` for a host whose arms aren't `heldArmsOf`'s. */
  readonly install: (host: SimHost, elite: NativeEliteBindings, restoring: boolean, heldBy?: SlotHeld) => void;
}
/** Read the encounter's rows now; nothing here touches a host. Null for rows with no slot actors. */
export async function prepareSlots(product: Pick<ShardFolder, 'json' | 'section' | 'file'>, files: SlotFiles): Promise<SlotPlan | null> {
  const timing = v.parse(TimedEncountersSchema, await product.json<unknown>(files.rows)), declared = timing.slots.actors;
  if (declared === undefined) return null;
  const plan = parseClientPlan(product.section('client/plan')), timed = plan.features.find(row => row.kind === 'timed.encounters'), view = plan.features.find(row => row.kind === 'view.program' && row.id === 'creature-views');
  if (timed?.kind !== 'timed.encounters' || view?.kind !== 'view.program') throw new Error('Slots require their timed encounter and creature view');
  const scenes = v.parse(v.object({ dressing: v.object({ phone: v.string() }) }), product.section('world/scenes'));
  const [poses, actors, dressing, module] = await Promise.all([readEncounterPoses(product, [declared.kind], files),
    product.json<unknown>(files.actors).then(input => v.parse(SpeciesActorsFileSchema, input)), product.json<unknown>(scenes.dressing.phone).then(input => v.parse(SceneDressingSchema, input)), product.file(view.module)]);
  const entry = actors.species.lookBook.rows.find(row => row.metadata.kind === declared.kind), rows = entry?.projection, sites = dressing.sites.find(row => row.name === timed.sites)?.rows;
  if (entry === undefined || rows === undefined || sites === undefined) throw new Error('Slots are missing their projection or their standing sites');
  const projected = parseActorProjectionV2(rows), { damage } = projected, placed = v.parse(EncounterSitesSchema, sites);
  if (damage === undefined || projected.step === undefined) throw new Error('Slots require their think and damage requests');
  const updates = new WeakMap<SimHost, (dt: number) => void>();
  return {
    advance: (host, dt) => { const run = updates.get(host); if (run === undefined) throw new Error('Slots were not installed before their patrol'); run(dt); },
    install: (host, elite, restoring, heldBy) => {
      const population = nativePopulationOf(host), clock = host.dayClock;
      if (population === undefined || clock === undefined || owners.has(host)) throw new Error('Slots require their population and day clock');
      const animations = poses.animations((x, z) => host.groundHeightAt(x, z)), presented = new Map<string, NativeCreaturePose>();
      const projection = new ActorProjectionV2(declared.kind, projected), brain = ReturnProgram.native(host, projected.program);
      const ownedBrains = new Map<AnimalSim, NonNullable<ReturnType<NativeEliteBindings['brains']['get']>>>();
      const columns = damage.requests.map(row => new ObservationColumnsV2(row.columns, host.scope));
      const held: SlotHeld = heldBy ?? (request => {
        const id = landedBy(request, host.players), player = id === null ? undefined : host.players.get(id), seat = player === undefined ? undefined : heldArmsOf(host)?.of(player), wire = seat?.snapshot();
        return typeof wire === 'string' ? v.parse(Held, JSON.parse(wire)) : null;
      });
      const bind = (body: HuntBody): void => {
        const recipe = poses.rows.find(row => row.kind === body.kind && row.variant === body.variant), animate = animations.get(body.kind);
        if (recipe === undefined || animate === undefined || presented.has(body.entityId)) throw new Error('A slot body lost its contact recipe');
        const attached = attachNativeCreaturePose(body, recipe.pose, animate);
        presented.set(body.entityId, attached.pose);
        const bound: NonNullable<ReturnType<NativeEliteBindings['brains']['get']>> = { think: (actor, context) => {
          if (actor !== body || !liveContext(context)) throw new Error('A slot decision lost its native observations');
          projection.step(body, context, { scope: host.scope, group: declared.kind, slot: 0, identity: body.entityId });
        }, act: () => undefined };
        ownedBrains.set(body, bound); elite.brains.set(body, bound);
        body.combatActor().damageMul = request => {
          const equipment = held(request), results: Record<string, number> = {};
          for (const [index, query] of damage.requests.entries()) {
            const table = columns[index];
            if (table === undefined) throw new Error('Missing slot damage columns');
            const values = Object.fromEntries(table.capture({ scope: host.scope, self: { group: declared.kind, slot: 0, identity: body.entityId, actor: body }, observed: new Map(), player: { position: body.position }, t: 0, dt: 0, hit: request.point, request,
              equipment: equipment?.enabled === true ? equipment.slot : '', results }).map(row => [row.name, row.value]));
            Object.assign(results, brain.project(query.signal, values));
          }
          const value = results[damage.result];
          if (value === undefined || !Number.isFinite(value)) throw new Error('Missing slot damage result');
          return value;
        };
      };
      const count = placed.sites.length, standing = Array.from({ length: count }, () => false);
      const solids = new Map<number, Solid>(), bodies = (): readonly HuntBody[] => population.bodies, near = (a: number, b: number): boolean => Math.abs(a - b) < EXACT;
      /** A statue's box, by where its site stands: the bake keeps no name on it. */
      const solidAt = (index: number): Solid => {
        const known = solids.get(index), site = placed.sites[index];
        if (known !== undefined) return known;
        if (site === undefined) throw new Error(`No slot site ${String(index)}`);
        const { world, R } = host.physics, found: Solid[] = [];
        world.forEachCollider(collider => {
          if (collider.shapeType() !== R.ShapeType.Cuboid) return;
          const at = collider.translation(), half = collider.halfExtents();
          if (half !== null && near(at.x, site.x) && near(at.z, site.z) && near(half.x, placed.collider.hw * site.scale) && near(half.z, placed.collider.hd * site.scale)) found.push(collider);
        });
        const [solid] = found;
        if (solid === undefined || found.length !== 1) throw new Error(`Slot site ${String(index)} has ${String(found.length)} standing colliders`);
        solids.set(index, solid);
        return solid;
      };
      const stand = (index: number, awake: boolean): void => { standing[index] = awake; solidAt(index).setEnabled(!awake); };
      const law = new SlotEncounterLaw<HuntBody, SlotTell>(timing.slots, timing.view, ReturnProgram.native(host, timing.program), {
        sites: placed.sites.map((site, index) => ({ x: site.x, z: site.z, yaw: site.yaw, variant: placed.variantCycle[index % placed.variantCycle.length] ?? 0 })),
        wedges: noTells(timing.view.tell.pool), guest: brain, ground: (x, z) => host.groundHeightAt(x, z), cosmetic: () => host.rng.stream('cosmetic').next(), cues: { cue: () => undefined } });
      law.attachActors({ factory: { model: (kind, variant) => { population.validateSpawn(kind, variant); return kind; } },
        spawn: (kind, x, z, yaw, variant) => { const body = population.spawnElite(kind, x, z, yaw, variant); bind(body); return body; },
        retire: body => { population.retireElite(body); elite.brains.delete(body); ownedBrains.delete(body); presented.delete(body.entityId); } });
      for (const body of population.bodies) if (body.kind === declared.kind) bind(body);
      if (restoring) onSimHostRestored(host, () => { for (const [actor, bound] of ownedBrains) elite.brains.set(actor, bound); });
      const heights = new SlotHeights(module, view.rows, declared.kind, host.scope, bodies, (x, z) => host.groundHeightAt(x, z));
      updates.set(host, dt => { for (const change of law.update(dt, { kind: Number(timing.phases.slots.includes(clock.dayPhase)) })) stand(change.index, change.awake === 1); });
      host.onStep(`${files.step}.slots`, () => undefined, { snapshot: () => { const sinking = heights.snapshot(); return JSON.stringify({ version: 1, law: law.snapshot(body => body.entityId), sites: [...standing], poses: [...presented].map(([id, pose]) => [id, pose.snapshot()]), ...(sinking === null ? {} : { heights: sinking }) }); }, restore: value => {
        if (typeof value !== 'string') throw new Error('A slot continuation is a string');
        const parsed: unknown = JSON.parse(value), saved = v.parse(Saved, parsed);
        if (saved.sites.length !== count || saved.poses.length !== population.bodies.filter(body => body.kind === declared.kind).length) throw new Error('A slot continuation lost its roster');
        for (const [id, wire] of saved.poses) { const pose = presented.get(id); if (pose === undefined) throw new Error('Missing a restored slot pose'); pose.restore(wire); }
        law.restore(saved.law, id => population.bodies.find(body => body.entityId === id && body.kind === declared.kind) ?? null);
        saved.sites.forEach((awake, index) => { standing[index] = awake; });
        if (saved.heights !== undefined) heights.restore(saved.heights);
      }, physicsRestored: () => { solids.clear(); standing.forEach((awake, index) => { solidAt(index).setEnabled(!awake); }); } });
      host.onStep(`${files.step}.slot-poses`, dt => {
        heights.frame(dt);
        for (const [id, pose] of presented) {
          const body = host.entities.get(id), step = host.bodyDt(id);
          if (body === undefined) throw new Error('A slot body retired unexpectedly');
          if (step <= 0) continue;
          pose.advance(step, host.clock.now, body.position.distanceToSquared(host.nearestPlayer(body.position).position) < POSED_WITHIN * POSED_WITHIN);
          pose.publish();
        }
      }, undefined, 'afterBodies');
      const awakeRows = slotAwakeRows(count);
      publishWorldState(host, 'slots', () => awakeRows.read(standing));
      owners.set(host, { law, standing: () => standing, solid: solidAt, adopt: body => {
        if (body.kind !== declared.kind || host.entities.get(body.entityId) !== body || !population.bodies.includes(body) || law.awake.some(row => row.a === body)) throw new Error('A foreign body for these slots');
        bind(body);
      } });
      host.scope.onDispose(() => { owners.delete(host); updates.delete(host); presented.clear(); ownedBrains.clear(); solids.clear(); });
    },
  };
}
