/** A wind-borne elite on a server (Nalati's Qyran): the page's `DiverBrain` wind law over a body the population raises for it, its rows read
 *  from the page's own plan, so no new file ships and the world's roster, records and tapes stay as they are. It keeps its own rules and
 *  its own save, and a world saved before it flew here restores with it unspawned. Only a room installs it; a page's own host keeps its own. */
import * as v from 'valibot';
import { Vector3 } from 'three';
import { DiverBrain, readWindDiverSpec } from '@wildshard/engine/ai/diver';
import type { NativeEliteBindings } from '@wildshard/engine/ai/eliteRoster';
import type { HuntBody } from '@wildshard/engine/ai/hunt';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { canReach } from '@wildshard/engine/ai/reach';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { StrikeRunner } from '@wildshard/engine/ai/strikes';
import type { SimHost } from '@wildshard/engine/sim';
import { eliteNetView, publishEncounter } from '@wildshard/engine/sim/encounterRows';
import { nearestOnGround } from '@wildshard/engine/sim/nearPlayer';
import { ELITE_MOMENTS, eliteMomentWord, eliteWindWord, sayFightView } from '@wildshard/engine/sim/shardRows';
import { EliteFeatureSchema } from '@wildshard/format/eliteFeature';
import type { EliteCore, EliteCoreRecord, EliteCoreScript } from '../../../shared/game/eliteSystem';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import type { EncounterIntake } from '../population/encounterIntake';
import { readEncounterIntake } from '../population/encounterBook';
import { nativePopulationOf } from '../riding/nativePopulation';

const finite = v.pipe(v.number(), v.finite()), pair = v.tuple([finite, finite]);
const Profile = v.object({ id: v.string(), value: v.object({ def: EliteFeatureSchema.entries.fights.pipe[0].item.entries.def, pattern: v.string(), kind: v.string(), yaw: finite, offset: pair, spec: v.unknown() }) });
const Plan = v.object({ features: v.array(v.looseObject({ kind: v.string() })) });
const Construct = v.object({ rows: v.object({ profiles: v.array(Profile), strikes: v.array(v.object({ amount: finite, strike: v.unknown() })) }) });
const Rock = v.object({ rock: v.object({ x: finite, z: finite, top: finite }) });
const Saved = v.strictObject({ version: v.literal(1), body: v.nullable(v.string()), policy: v.unknown(), phase2: v.boolean(), pinned: v.boolean(), core: v.unknown() });
/** How its stoop throws a player: the world's own elites' knockdown row. */
export interface WindKnock { readonly speed: number; readonly min: number; readonly max: number; readonly seconds: number }
export interface NativeWindElite {
  readonly advance: (dt: number) => void;
  /** Its lair and record, for the world's rules to read as their own: what a quest counts of its kills. */
  readonly lair: { readonly id: string; readonly record: EliteCoreRecord | undefined };
}
type Core = EliteCore<EliteCoreScript<AnimalSim>>;

function planRows(product: Pick<ShardFolder, 'section' | 'has'>) {
  if (!product.has('client/plan')) return null;
  const { features } = v.parse(Plan, product.section('client/plan'));
  const rows = features.find(row => row.kind === 'elite.construct'), rock = features.find(row => row.kind === 'elite.entry');
  if (rows === undefined || rock === undefined) return null;
  const { profiles, strikes } = v.parse(Construct, rows).rows, profile = profiles.find(row => row.value.pattern === 'wind')?.value;
  return profile === undefined ? null : { profile, strikes, rock: v.parse(Rock, rock).rock };
}
/** The body a world lends it, if it flies at all. It's a grounded body lifted by its law, and a motor would stand at its spawn and stop a player. */
export async function readWindIntake(product: Pick<ShardFolder, 'section' | 'has' | 'json'>, actors: string): Promise<EncounterIntake> {
  const rows = planRows(product);
  if (rows === null) return { species: [], recipes: [] };
  return { ...await readEncounterIntake(product, [rows.profile.kind], actors), motorless: [rows.profile.kind] };
}

/** Read its rows now; nothing here touches a host. No wind row in the plan: nothing flies. */
export function prepareWindElite(product: Pick<ShardFolder, 'section' | 'has'>, knock: WindKnock):
  ((host: SimHost, bindings: NativeEliteBindings, makeCore: () => Core, step: string, wind: () => { readonly x: number; readonly z: number }) => NativeWindElite) | null {
  const rows = planRows(product);
  if (rows === null) return null;
  const { profile, rock } = rows, spec = readWindDiverSpec(profile.spec), { def } = profile, id = def.id, row = rows.strikes.find(candidate => candidate.amount === spec.stoop.damage);
  if (row === undefined) throw new Error('Missing wind elite contact');
  const strike = strikeFromData(row.strike as Parameters<typeof strikeFromData>[0]), { fields } = spec;
  return (host, bindings, makeCore, step, wind) => {
    const population = nativePopulationOf(host);
    if (population === undefined) throw new Error('A wind elite needs its population');
    const core = makeCore(), contact = new StrikeRunner(), { brains, pinned } = bindings, head = new Vector3(), direction = new Vector3(), word = eliteMomentWord(id), said = eliteWindWord(id);
    let body: HuntBody | null = null, phase2 = false, time = 0, telling = false, seen: { height: number; snap: number } | null = null;
    const foeOf = (at: { readonly x: number; readonly z: number }) => nearestOnGround(host.players, at.x, at.z);
    const moment = (name: typeof ELITE_MOMENTS[number], at?: { readonly x: number; readonly y: number; readonly z: number }): void => { sayFightView(host, word, [ELITE_MOMENTS.indexOf(name), at?.x ?? 0, at?.y ?? 0, at?.z ?? 0]); };
    const policy = new DiverBrain<HuntBody>(null, { pattern: 'wind', spec, ports: {
      player: { get position() { return foeOf(body?.position ?? def.lair).position; } }, rock, phase2: () => phase2, heightAt: (x, z) => host.groundHeightAt(x, z), wind, random: () => host.rng.stream('ai').next(),
      isHead: (actor, point) => actor.headWorld(head).distanceTo(point) < actor.dims.headRadius * actor.scale + .12,
      tell: { setTime: at => { time = at; }, chevron: () => undefined,
        aim: (from, to, alpha) => { telling = true; sayFightView(host, said, [from.x, from.y, from.z, to.x, to.y, to.z, alpha, time]); },
        hide: () => { if (telling) sayFightView(host, said, []); telling = false; } },
      hurt: (actor, amount) => {
        const struck = foeOf(actor.position);
        contact.contact(strike, { actor, target: struck.position, canReach: () => canReach(actor, struck.position, host.physics), hit: () => {
          host.combat.hit({ source: 'env', sourceTags: [`elite.${id}`, 'feel.blow', 'cover.checked'], target: struck.health, amount, point: actor.position, dir: direction.set(0, 0, 0), cause: { kind: actor.kind, label: actor.label } }); } });
      },
      knock: (dx, dz) => {
        const length = Math.hypot(dx, dz) || 1, speed = knock.speed * Math.max(knock.min, Math.min(knock.max, 1));
        foeOf(body?.position ?? def.lair).dashAt(dx / length * speed, dz / length * speed, knock.seconds);
      },
      grounded: () => { moment('grounded'); }, cry: at => { moment('cry', at); }, signature: () => { core.signature(id); },
    } });
    const bind = (actor: HuntBody): void => {
      body = actor; seen = null; actor.driven = true; // its law owns the body: no motor, no ground follow pulling it back under its height
      brains.set(actor, { think: (brainBody, context) => { policy.decideWind(brainBody as HuntBody, context); }, act: () => undefined });
      actor.combatActor().damageMul = request => policy.windDamage(actor, request.point);
    };
    const release = (actor: HuntBody): void => { pinned.delete(actor); brains.delete(actor); body = null; seen = null; };
    /** The height the page's `creatureViews.as` gives this law, kept here: a body's height is what an arrow hits, and a row carries it to every page. */
    const lift = (actor: HuntBody, dt: number): void => {
      const ground = host.groundHeightAt(actor.position.x, actor.position.z);
      if (!actor.alive) { actor.driven = false; actor.yOffset = 0; actor.position.y = ground; return; }
      const altitude = actor.mem[fields.altitude] ?? ground + 20, snap = actor.mem[fields.smoothed] ?? 0;
      seen ??= { height: altitude, snap };
      if (snap !== seen.snap) seen = { height: snap, snap };
      seen.height += (altitude - seen.height) * Math.min(1, dt * 6);
      actor.position.y = seen.height;
    };
    const script: EliteCoreScript<AnimalSim> = {
      def, get animal() { return body; },
      spawn: () => {
        if (body?.alive === true) throw new Error('A wind elite cannot respawn a live owner');
        if (body !== null) { const corpse = body; release(corpse); population.retireElite(corpse); }
        const actor = population.spawnElite(profile.kind, def.lair.x + profile.offset[0], def.lair.z + profile.offset[1], profile.yaw, id);
        actor.herd = -1; policy.spawnWind(actor); bind(actor); lift(actor, 0);
      },
      despawn: () => { policy.disposeWindTell(); if (body !== null) { const actor = body; release(actor); population.retireElite(actor); } },
      reset: () => { phase2 = false; policy.resetWind(); },
      enterPhase2: () => { phase2 = true; }, trophy: () => undefined,
      tick: (dt, at, engaged, leashing) => {
        if (body === null) return;
        if (engaged) pinned.add(body); else pinned.delete(body);
        policy.advanceWind(body, dt, at, engaged, leashing); lift(body, dt);
      },
    };
    const entry = core.add(script);
    publishEncounter(host, id, () => eliteNetView({ ...entry, script }));
    host.onStep(step, () => undefined, {
      joined: true,
      snapshot: () => JSON.stringify({ version: 1, body: body?.entityId ?? null, policy: policy.windSnapshot(), phase2, pinned: body !== null && pinned.has(body), core: core.snapshot() }),
      restore: value => {
        if (typeof value !== 'string') throw new Error('Wind elite continuation is a string');
        const saved = v.parse(Saved, JSON.parse(value)), commit = core.prepareRestore(saved.core), actor = saved.body === null ? null : population.bodies.find(candidate => candidate.entityId === saved.body) ?? null;
        if (actor === null && saved.body !== null) throw new Error('Wind elite continuation lost its body');
        if (body !== null) release(body);
        policy.restore(saved.policy); phase2 = saved.phase2;
        if (actor !== null) { bind(actor); if (saved.pinned) pinned.add(actor); }
        commit();
      },
    });
    return { lair: { id, record: core.record(id) }, advance: dt => {
      if (body !== null && !body.alive) { policy.disposeWindTell(); lift(body, dt); if (!population.bodies.includes(body)) release(body); }
      core.update(dt, host.clock.now);
    } };
  };
}
