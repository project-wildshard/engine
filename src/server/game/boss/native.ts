/** Native boss shell: roster lifetime, ordered presence/brain/room steps,
 * damage ownership, reward flags and save continuation are shared platform law. */
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { nativeDecisions } from '../shardfile/borrowedDecisions';
import { populationRoster, type NativePopulationActor } from '../population/roster';
import { grantNativeInventory } from '../../../shared/game/inventoryLaw';
import type { SpeciesProgramData } from '@wildshard/format/speciesPrograms';
import * as v from 'valibot';
import { Vector3 } from 'three';
import { canReach } from '@wildshard/engine/ai/reach';
import type { SimHost } from '@wildshard/engine/sim';
import { installBossRow } from '../shardfile/bossRow';
import { bossFlagRecord } from '../../../shared/game/plugin/bossRecord';
import { parseRoamingEncounter, NativeBossBindingSchema, type NativeBossBinding, type RoamingEncounterRow } from '@wildshard/format/bossEncounter';
import { groundBossDormant, createGroundBossFight, groundBossPresence, type GroundBossEnv, type GroundBossFight } from './roaming';
import { roamingFightState, restoreRoamingFight } from './continuation';
import { Lane } from '../../../shared/game/boss/lane';
import { ROAMING_HAZARD_EVENTS, ROAMING_STANDING, ROAMING_VIEW } from '../../../shared/game/shardfile/wirePrompts';
import { declareStandingLooks, sayFightView } from '@wildshard/engine/sim/shardRows';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { itemPickupFloor, ITEM_PICKUP_HOVER } from '@wildshard/engine/world/interact/pickup';
import { pickPrompt } from '@wildshard/engine/world/interact/prompts';
import { nearestOnGround } from '@wildshard/engine/sim/nearPlayer';

/** The actual native body remains owned by its installed population service; its limb pose roster publishes the ribs
 * volume (game/animation/limbPopulation `ribsWorld`: the chest chain, then the baked ribs point). */
export type NativeGroundBossBody = NativePopulationActor & { readonly ribsWorld?: (out: Vector3) => Vector3 };
type BossBrain = ReturnType<typeof installBossRow>['boss'];
/** Read-only controller facts from the same installed brain and fight. Saves
 * still use their full original continuation, including guest and lane state. */
interface NativeGroundBossObservation {
  readonly boss: {readonly state:string;readonly phase:number;readonly attempts:number};
  readonly fight: {readonly body:string|null;readonly mode:string;readonly open:number;
    readonly rings:readonly {readonly r:number;readonly on:boolean;readonly delay:number}[];
    readonly adds:readonly {readonly a:string;readonly mode:string}[]};
}
const observations=new WeakMap<SimHost,Map<string,()=>NativeGroundBossObservation>>();
/** No callback or mutable owner escapes into the controller. */
export function nativeGroundBossObservation(host:SimHost,id:string):NativeGroundBossObservation|undefined {
  return observations.get(host)?.get(id)?.();
}
/** Data references to built-in services; arbitrary ports are not admitted. */
const RIB_POINT = new Vector3();
/** The lane states `ROAMING_VIEW.lane` numbers. */
const LANE_STATES = ['none', 'tell', 'run', 'skid'] as const;


function nativeGroundFight(host: SimHost, row: RoamingEncounterRow, program: SpeciesProgramData, binding: NativeBossBinding): { fight: GroundBossFight<NativeGroundBossBody>; own: { first: boolean; light: boolean }; waves:readonly {readonly r:number;readonly on:boolean;readonly delay:number}[] } {
  const own = { first: false, light: false }, roster = () => populationRoster(host, binding.population);
  declareStandingLooks(host, ROAMING_STANDING);
  /** What a page on this server paints: the fight's own view calls, which are nothing here. */
  let tellTime = 0, telling = false, sealWas = 0, darkWas = 0;
  const ringing = new Set<number>();
  const tell = { setTime: (t: number): void => { tellTime = t; }, ring: (x: number, z: number, radius: number, alpha: number): void => { telling = true; sayFightView(host, ROAMING_VIEW.tell, [x, z, radius, alpha, tellTime]); },
    hide: (): void => { if (telling) sayFightView(host, ROAMING_VIEW.tellOff, []); telling = false; } };
  const sayLane = (slot: number, state: Lane<NativeGroundBossBody>): void => {
    if (state.state !== 'none') sayFightView(host, ROAMING_VIEW.lane, [slot, LANE_STATES.indexOf(state.state), state.t, state.tell, state.x0, state.z0, state.x1, state.z1, state.width, host.clock.now]);
  };
  const ribs = (body: NativeGroundBossBody, out: Vector3): Vector3 => {
    if (body.ribsWorld === undefined) throw new Error('Boss body has no ribs volume'); return body.ribsWorld(out);
  };
  const reach = (a: NativeGroundBossBody, target: { x: number; y: number; z: number }): boolean => canReach(a, target, host.physics);
  const player = { position: host.playerFocus };
  const env: GroundBossEnv<NativeGroundBossBody> = {
    reach,
    player: { position: player.position, get onGround(): boolean { return host.focusedPlayer.fall.grounded; }, shove: (x, z, speed) => { host.focusedPlayer.knockBack(x, z, speed); } },
    // ctx.hurt: blocked unless it reaches (or the move goes through walls), a blow the host knocks the player back from
    hurt: (a, amount, throughWalls = false) => {
      if (!throughWalls && !reach(a, player.position)) return;
      host.combat.hit({ source: a.combatActor(), sourceTags: [`creature.${a.kind}`, 'feel.blow', 'cover.checked'], target: host.nearestPlayer(a.position).health, amount,
        point: a.position.clone(), dir: new Vector3(), throughWalls, cause: { kind: a.kind, label: a.label } });
    },
    trauma: () => undefined, shot: () => undefined,
  };
  const profiles = new Map(program.strikes.map(strike => [strike.id, strikeFromData(strike)]));
  const bossLane = profiles.get(row.lanes.boss), addLane = profiles.get(row.lanes.add);
  if (bossLane === undefined || addLane === undefined) throw new Error('Missing admitted boss lanes');
  const lane = new Lane<NativeGroundBossBody>(bossLane, reach), waves = Array.from({ length: Math.max(...row.profile.fight.phases.map(phase => phase.rings)) }, () => ({ r: 0, on: false, hit: false, delay: 0 }));
  const addLanes = Array.from({ length: row.lanes.count }, () => new Lane<NativeGroundBossBody>(addLane, reach));
  const fight: GroundBossFight<NativeGroundBossBody> = createGroundBossFight(row, env, {
    groundAt: (x, z) => host.groundHeightAt(x, z),
    body: {
      make: () => {
        const parked = roster().parked().find(candidate => candidate.kind === row.kind);
        if (parked === undefined) throw new Error('Missing parked boss body');
        // Adopt the prewarm once; later appearances consume normal roster draws.
        const a = own.first ? roster().spawnLoose(parked.kind, row.profile.fight.origin.x, row.profile.fight.origin.z, 0, parked.variant)
          : roster().adoptParked(parked.id, row.profile.fight.origin.x, row.profile.fight.origin.z, 0);
        own.first = true;
        a.scripted = true;
        return a;
      },
      retire: k => { roster().retire(k); }, park: k => { k.hidden = true; }, unpark: k => { k.hidden = false; },
    },
    adds: {
      spawn: (kind, x, z, yaw) => {
        const a = roster().spawn(kind, x, z, yaw, row.adds.variant);
        // combat/ctx.ts own: out of its herd, under the fight's control
        a.herd = -1; a.state = row.adds.state; a.scripted = true;
        return a;
      },
      retire: a => { roster().retire(a); }, lanes: () => addLanes,
    },
    lane: () => lane, rings: () => waves,
    // the same forced chest-chain read as the page's cage getter, with its admitted radius
    weakPoint: p => { const k = fight.body; return k !== null && p.distanceTo(ribs(k, RIB_POINT)) < binding.weakPoint.radius * k.scale; },
    views: {
      glow: () => undefined, hung: () => undefined, focus: (k, out) => ribs(k, out),
      // the page's light samples the chest only before the final darkness phase moves it to the camera
      room: () => {
        if (own.light && fight.body !== null) {
          if (fight.darkK <= 0.5) ribs(fight.body, RIB_POINT);
          sayFightView(host, ROAMING_VIEW.light, [1, RIB_POINT.x, RIB_POINT.y, RIB_POINT.z, fight.glow, fight.open]); // each tick: a page that came late has it within one
        }
        if (fight.sealK !== sealWas || fight.darkK !== darkWas) { sealWas = fight.sealK; darkWas = fight.darkK; sayFightView(host, ROAMING_VIEW.room, [sealWas, darkWas]); }
        sayLane(0, lane); addLanes.forEach((add, index) => { sayLane(index + 1, add); });
        // what the page's rig reads off its own fight, each tick: a page that came late has it within one. A hazard hangs until its phase drops it.
        if (fight.present && fight.body !== null) sayFightView(host, ROAMING_VIEW.rig, [fight.glow, fight.open, fight.phase < row.profile.fight.hazards.fromPhase ? 1 : 0]);
      },
      light: on => { if (own.light && !on) sayFightView(host, ROAMING_VIEW.light, [0]); own.light = on; },
      action: (k, move) => { k.mem[row.actionField] = row.actions[move] ?? 0; },
      roar: k => { sayFightView(host, ROAMING_VIEW.roar, [k.position.x, k.position.y, k.position.z]); },
      burst: k => { sayFightView(host, ROAMING_VIEW.burst, [k.position.x, k.position.y, k.position.z]); },
      hazard: (i, f, t, event) => { const from = fight.body?.position; sayFightView(host, ROAMING_VIEW.hazard, [i, ROAMING_HAZARD_EVENTS.indexOf(event), t, f.x, f.y, f.z, f.fallT, from?.x ?? f.x, from?.y ?? f.y, from?.z ?? f.z]); },
      add: (a, event) => { sayFightView(host, ROAMING_VIEW.add, [event === 'in' ? 1 : 0, a.position.x, a.position.y, a.position.z]); },
      ring: (i, t, at) => {
        if (at === null && !ringing.delete(i)) return; // a ring at rest is told so every tick
        if (at !== null) ringing.add(i);
        sayFightView(host, ROAMING_VIEW.ring, [i, t, at === null ? 0 : 1, at?.x ?? 0, at?.z ?? 0, waves[i]?.r ?? 0]);
      },
      tell,
    },
  }, host.level.seed, program, nativeDecisions(host));
  return { fight, own, waves };
}

/** A standing player's eye over their feet, where a press reaches a reward from. */
const REACH_EYE = 1.68;
const rewards = new WeakMap<SimHost, Map<string, { take: (eye: { x: number; y: number; z: number }) => boolean }>>();
/** Resolve a concrete encounter reward by its declared step identity. */
export function takeNativeBossReward(host: SimHost, id: string, eye: { x: number; y: number; z: number }): boolean {
  const reward = rewards.get(host)?.get(id); if (reward === undefined) throw new Error('Missing native boss reward'); return reward.take(eye);
}

const finite = v.pipe(v.number(), v.finite());
/** Install from rows without allocating a body or consuming a random draw. */
export function installGroundBoss(host: SimHost, input: unknown, profile: unknown, program: SpeciesProgramData, bindingInput: unknown, grantItem?: (player: string, item: string, count: number) => void): { boss: BossBrain; fight: GroundBossFight<NativeGroundBossBody>; locked: () => boolean;
  rewardPoint: () => { x: number; y: number; z: number } | null; takeReward: (eye: { x: number; y: number; z: number }) => boolean } {
  const row = parseRoamingEncounter(input, profile), binding = v.parse(NativeBossBindingSchema, bindingInput), roster = () => populationRoster(host, binding.population);
  const { fight, own, waves } = nativeGroundFight(host, row, program, binding), brain: { boss: BossBrain | null } = { boss: null }, origin = row.profile.fight.origin;
  host.onStep(row.steps.presence, () => { if (brain.boss !== null) groundBossPresence(row, brain.boss, fight, nearestOnGround(host.players, origin.x, origin.z).position, (host.dayClock?.night ?? 0) > 0.5); });
  // read at install (a restoring install's record is the brain's continuation, which restores over it)
  const record = bossFlagRecord(host.flags, row.record), saved = record.saved;
  let reward: { x: number; y: number; z: number } | null = null;
  const owner = installBossRow(host, { step: row.steps.fight, definition: { ...row.definition, reward: { trophy: () => { grantNativeInventory(host, binding.reward.inventory, binding.reward.grants); } } }, script: fight, body: () => fight.body, shielded: () => fight.shielded,
    fight: {
      // Parked visibility belongs to the fight, outside the body's entity record.
      snapshot: () => ({ first: own.first, lightActive: own.light, hidden: fight.body?.hidden === true, ...roamingFightState(row, fight) }),
      restore: value => {
        const { first, lightActive, hidden } = v.parse(v.object({ first: v.boolean(), lightActive: v.boolean(), hidden: v.boolean() }), value);
        own.first = first;
        own.light = lightActive;
        const actors = new Map<string, NativeGroundBossBody>();
        for (const id of host.entities.keys()) { const actor = roster().actor(id); if (actor !== null) actors.set(id, actor); }
        restoreRoamingFight(row, fight, value, actors);
        if (fight.body !== null) fight.body.hidden = hidden;
      },
    }, saved, persist: record.persist, rewardPoint: () => reward,
    spawnReward: () => { const at = itemPickupFloor(host.physics, fight.rewardPoint()); reward = { x: at.x, y: at.y + ITEM_PICKUP_HOVER + row.reward.hover, z: at.z }; } });
  const Reward = v.strictObject({ version: v.literal(1), point: v.nullable(v.strictObject({ x: finite, y: finite, z: finite })) });
  host.onStep(row.steps.reward, () => undefined, {
    snapshot: () => ({ version: 1, point: reward === null ? null : { ...reward } }),
    restore: value => { const state = v.parse(Reward, value); if (state.point !== null && (!saved.defeated || saved.rewardTaken)) throw new RangeError('Incompatible boss reward'); reward = state.point; },
  });
  brain.boss = owner.boss;
  // The script's damage rule at pipeline order 50: beats and dormant bodies shrug a hit
  // off (×0.01), the open ribcage takes ×3 (shut ×0.6), the bark ×0.25
  host.events.answer('damage.modify', req => {
    const k = fight.body;
    if (req === null || k === null || req.target !== k.combatActor()) return req;
    return { ...req, amount: Math.max(1, Math.round(req.amount * fight.damageMul(k, req.point))) };
  }, host.scope, { order: 50 });
  // Where a blow landed on him: the page judges the ribs off its own rig, as it does for its own fight.
  host.events.on('damage.dealt', ({ req }) => {
    if (fight.body === null || req.target !== fight.body.combatActor()) return;
    const { point, dir } = req;
    sayFightView(host, ROAMING_VIEW.struck, [point.x, point.y, point.z, dir.x, dir.y, dir.z]);
  }, host.scope);
  host.onStep(row.steps.dormant, dt => { if (fight.body !== null) host.focusOn(fight.body.position); groundBossDormant(owner.boss, fight, dt, host.clock.now); });
  const result = { boss: owner.boss, fight, locked: owner.locked,
    rewardPoint: () => reward === null ? null : { ...reward },
    takeReward: (eye: { x: number; y: number; z: number }) => {
      if (reward === null || saved.rewardTaken || pickPrompt([{ position: reward, radius: row.reward.radius }], eye, host.physics) === undefined) return false;
      // J105: in a room the orb is each earner's own, and it stands until the last of them has taken theirs.
      const { bounty } = owner;
      if (bounty.room) {
        const player = host.nearestPlayer(eye).id;
        if (!bounty.take(player)) return false;
        // J105: the trophy is this player's own, in the ledger, not the first player's pack
        for (const { item, count } of binding.reward.grants) grantItem?.(player, item, count);
        if (bounty.owed.length > 0) return true;
      }
      reward = null; saved.rewardTaken = true; record.persist(saved); return true;
    } };
  const book = rewards.get(host) ?? new Map<string, { take: (eye: { x: number; y: number; z: number }) => boolean }>();
  if (book.has(row.steps.fight)) throw new Error('Duplicate native boss reward');
  book.set(row.steps.fight, { take: result.takeReward }); rewards.set(host, book);
  actRoutes(host).claims.set(`${row.steps.fight}.reward`, player => {
    const feet = host.players.get(player)?.position;
    if (feet !== undefined) result.takeReward({ x: feet.x, y: feet.y + REACH_EYE, z: feet.z });
  });
  const readers=observations.get(host)??new Map<string,()=>NativeGroundBossObservation>();
  readers.set(row.steps.fight,()=>({boss:{state:owner.boss.state,phase:owner.boss.phase,attempts:owner.boss.attempts},fight:{
    body:fight.body?.entityId??null,mode:fight.mode,open:fight.open,
    rings:waves.map(wave=>({r:wave.r,on:wave.on,delay:wave.delay})),adds:fight.adds.map(add=>({a:add.a.entityId,mode:add.mode})),
  }}));
  observations.set(host,readers);
  host.scope.onDispose(() => { book.delete(row.steps.fight);readers.delete(row.steps.fight); });
  return result;
}
