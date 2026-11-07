/** The arena room on a SimHost (P1-E3.4, J104, J107): the same fight the page runs, for every player of a room. The fight
 *  deals with the living player past the threshold nearest the body; those past it at the start set its health and its
 *  targets; a fallen player goes back alone with the fight's progress kept, and the fight resets once nobody is inside.
 *  One player runs the row's fight and numbers exactly. Nothing here draws. */
import type { EncounterReward } from '@wildshard/engine/sim/encounterRows';
import * as v from 'valibot';
import type { BossDefinition, BossSaved } from '@wildshard/engine/ai/BossBrain';
import type { BossContenders } from '@wildshard/engine/ai/bossContenders';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { parseBossProfile } from '@wildshard/format/bossProfiles';
import type { PhasedBossFight } from '../plugin/bossPhase';
import { installBossRow } from '../shardfile/bossRow';
import { sandWireName, type ArenaRoomGround } from '../../../shared/game/boss/arenaGround';
import { publishWorldState, sayFightView } from '@wildshard/engine/sim/shardRows';
import { ArenaPortalLaw, type ArenaPortalEntrance } from '../../../shared/game/boss/arenaPortal';
import type { ArenaRoomPortalRows, BoundedArenaFight } from '../../../shared/game/boss/arenaRoomRows';
import type { BossBounty } from './bounty';
import { arenaRoomFight, type ArenaFightBody, type ArenaFightTarget } from './arenaRoomFight';
import { NativeArenaSand } from './nativeArenaSand';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';

/** A body as a SimHost's roster keeps it. */
export type ArenaRoomBody = AnimalSim & ArenaFightBody;
/** The row's first-think memory (`ArenaRoomSpeciesControlSchema`'s `initialize`). */
export interface ArenaRoomFirstThink { readonly flag: string; readonly defaults: readonly ({ readonly field: string } & ({ readonly source: 'height' } | { readonly source?: undefined; readonly value: number }))[] }
export interface ArenaRoomNativeRows {
  /** The fight's fixed step; its brain, sand and seal hang off it. */
  readonly step: string;
  readonly room: ConstructorParameters<typeof ArenaRoomGround>[0] & { readonly id: string };
  readonly definition: BossDefinition;
  readonly fight: BoundedArenaFight;
  readonly initialize?: ArenaRoomFirstThink;
  /** The way in from the surface, each player's own (the page has one portal, a room one per player). Absent: walk in. */
  readonly portal?: ArenaRoomDoorRows;
}
/** The portal's rows and the admitted program that decides it. */
export interface ArenaRoomDoorRows {
  readonly rows: Pick<ArenaRoomPortalRows, 'signal' | 'end' | 'spawn' | 'exitOffset' | 'slow' | 'floor'> & { readonly fade: Pick<ArenaRoomPortalRows['fade'], 'hold'> };
  readonly program: ConstructorParameters<typeof ArenaPortalLaw>[0];
  readonly entrance: ArenaPortalEntrance;
}
/** What the host's roster and world lend the fight. */
export interface ArenaRoomNativePorts<A extends ArenaRoomBody> {
  readonly spawnBody: () => A | null;
  readonly spawnAdd: (index: number, x: number, z: number, yaw: number) => A;
  readonly retire: (actor: A) => void;
  /** A body by its entity id, for a restore. */
  readonly find: (id: string) => A | null;
  /** The door's collider. */
  readonly seal: (on: boolean) => void;
  readonly saved: BossSaved;
  readonly persist: (saved: BossSaved) => void;
  readonly spawnReward?: () => void;
  /** Where the reward lies on its row: the room's own orb. */
  readonly rewardPoint?: () => EncounterReward | null;
  /** A player the fight just put back: their motor and kit. */
  readonly returned?: (player: PlayerSim) => void;
}
const THINK = 0.1;
const finite = v.pipe(v.number(), v.finite());
const Door = v.strictObject({ inside: v.boolean(), elapsed: finite, fade: finite, pending: v.nullable(v.picklist(['enter', 'exit'])) });
const Saved = v.strictObject({ think: finite, sealed: v.boolean(), fight: v.unknown(), sand: v.unknown(), doors: v.exactOptional(v.array(v.tuple([v.string(), Door]))) });

/** Install the fight in its armed state, waiting at the door. No body is spawned until the first reset. */
export function installArenaRoom<A extends ArenaRoomBody>(host: SimHost, rows: ArenaRoomNativeRows, ports: ArenaRoomNativePorts<A>): {
  boss: ReturnType<typeof installBossRow>['boss']; party: BossContenders; bounty: BossBounty; inside: (id: string) => boolean; fight: PhasedBossFight<A>; ground: ArenaRoomGround; locked: () => boolean;
} {
  const sand = new NativeArenaSand(host, rows.room, `${rows.step}.sand`, sandWireName(rows.room.id)), ground = sand.ground, profile = parseBossProfile(rows.fight.profile);
  publishWorldState(host, `${rows.step}.sand`, () => sand.wire);
  if (profile.pattern !== 'arena') throw new Error('Arena room requires an arena boss profile');
  const owner: { party: BossContenders | null; fight: PhasedBossFight<A> | null } = { party: null, fight: null };
  const doors = new Map<string, ArenaPortalLaw>();
  let sealWanted = false, sealShown = false, think = 0;
  /** The door shuts with the fight, and stands open while anyone waits outside it to come back in (J107). */
  const seal = (): void => {
    const waiting = host.players.size > 1 && [...host.players.values()].some(player => ground.inDromos(player.position));
    const on = sealWanted && !waiting; if (on !== sealShown) { sealShown = on; ports.seal(on); }
  };
  const at = rows.room.origin;
  const target = (): ArenaFightTarget => {
    const { party } = owner, body = owner.fight?.body() ?? null;
    if (party === null) throw new Error('Arena fight has no room yet');
    const player = party.nearest(body === null ? at : body.position);
    return { position: player.position, dash: (x, z, seconds) => { player.dashAt(x, z, seconds); }, health: player.health };
  };
  const { phased: fight, script } = arenaRoomFight<A>({
    room: { floorHeightAt: (x, z) => ground.floorAt(x, z), addSand: (...pile) => { ground.addSand(...pile); }, clearSand: () => { ground.clearSand(); },
      drainSand: (dt, rate) => { ground.drainSand(dt, rate); }, inChamber: p => ground.inChamber(p), setSealed: on => { sealWanted = on; seal(); } },
    body: { spawn: ports.spawnBody, retire: ports.retire, bind: (actor, brain) => { actor.combatActor().damageMul = request => brain.damageMul(actor, request.point); }, ready: (actor, floorY) => { actor.yOffset = floorY - actor.position.y; } },
    spawnAdd: ports.spawnAdd, target, combat: host.combat, physics: () => host.physics, rng: () => host.rng.stream('ai').next(), feed: () => undefined,
  }, rows.fight, () => Object.fromEntries(profile.fight.views.map(id => [id, (...args: number[]): void => { sayFightView(host, id, args); }])));
  const row = installBossRow(host, { step: rows.step, row: rows.definition.id, definition: rows.definition, script, body: () => fight.body(), shielded: () => script.shielded,
    hazardTag: rows.fight.damageTag, saved: ports.saved, persist: ports.persist, armed: true,
    ...(ports.spawnReward === undefined ? {} : { spawnReward: ports.spawnReward }), ...(ports.rewardPoint === undefined ? {} : { rewardPoint: ports.rewardPoint }), ...(ports.returned === undefined ? {} : { returned: ports.returned }),
    fight: { snapshot: () => ({ think, sealed: sealWanted, fight: fight.continuation(actor => actor.entityId), sand: sand.snapshot(),
      ...(rows.portal === undefined ? {} : { doors: [...doors].map(([id, law]) => [id, law.snapshot()]) }) }),
      restore: value => {
        const saved = v.parse(Saved, value); think = saved.think; sealWanted = saved.sealed;
        for (const [id, door] of saved.doors ?? []) { const portal = rows.portal; if (portal !== undefined) { const law = new ArenaPortalLaw(portal.program, portal.rows, portal.entrance); law.restore(door); doors.set(id, law); } }
        sand.restore(saved.sand); sand.republish(); fight.restore(saved.fight, ports.find);
      } } });
  owner.party = row.party; owner.fight = fight;
  const { portal } = rows;
  const put = (player: PlayerSim, x: number, y: number, z: number, yaw: number): void => { player.position.set(x, y, z); player.motor.resetAt(player.position); player.yaw = yaw; ports.returned?.(player); };
  const through = (player: PlayerSim, door: ArenaRoomDoorRows, dt: number): void => {
    const law = doors.get(player.id) ?? new ArenaPortalLaw(door.program, door.rows, door.entrance), p = player.position; doors.set(player.id, law);
    const step = law.step(dt, () => ({ px: p.x, py: p.y, pz: p.z, floor: ground.floorAt(p.x, p.z), volume: ground.inVolume(p), engaged: row.boss.engaged,
      sand: ground.inChamber(p) ? ground.sandAt(p.x - at.x, p.z - at.z) : 0, originY: at.y, originZ: at.z }));
    const out = (): void => { const { x, y, z, facing } = door.entrance, back = door.rows.exitOffset; put(player, x - Math.sin(facing) * back, y, z - Math.cos(facing) * back, facing); law.inside = false; player.moveScale = 1; };
    if (step.kind === 'faded') {
      if (step.pending === 'enter') { const { spawn } = door.rows; put(player, at.x + spawn.x, at.y, at.z + spawn.z, spawn.yaw); law.inside = true; } else if (step.pending === 'exit') out();
    } else if (step.kind === 'decided') {
      if (!law.inside) { if (step.enter) law.begin('enter', door.rows.fade.hold); return; }
      if (step.exit === 2) { law.begin('exit', door.rows.fade.hold); return; }
      if (step.exit !== 0) { law.inside = false; player.moveScale = 1; return; }
      player.moveScale = step.slow ? door.rows.slow : 1;
    }
    if (!law.inside || step.kind === 'fading') return;
    // The page's floor law (J112): a body a little under the floor stands back on it. Past the row's depth it's a fall, and the fall's owner has it.
    const floor = ground.floorAt(p.x, p.z), { tolerance, depth } = door.rows.floor;
    if (floor !== undefined && p.y < floor - tolerance && p.y > floor - depth) { p.y = floor; player.motor.resetAt(p); }
  };
  host.onStep(`${rows.step}.brain`, dt => {
    if (portal !== undefined) for (const player of host.players.values()) through(player, portal, dt);
    seal(); sand.advance(dt);
    const body = fight.body(); if (body === null || !body.alive) return;
    const foe = row.party.nearest(body.position).position, initial = rows.initialize;
    if (initial !== undefined && body.mem[initial.flag] !== 1) {
      body.mem[initial.flag] = 1;
      for (const entry of initial.defaults) body.mem[entry.field] ??= entry.source === 'height' ? host.groundHeightAt(body.position.x, body.position.z) : entry.value;
    }
    think += dt; if (think >= THINK) { fight.brain.think(body, { dt: think, player: foe }); think = 0; }
    fight.brain.act(body, { player: foe });
  });
  const inside = (id: string): boolean => doors.get(id)?.inside === true;
  actRoutes(host).inside = inside;
  return { boss: row.boss, party: row.party, bounty: row.bounty, inside, fight, ground, locked: row.locked };
}
