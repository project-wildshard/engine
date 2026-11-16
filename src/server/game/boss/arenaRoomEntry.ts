/** A room fight from its product rows (P1-E3.4): the page's `combat/room-entry.json` on a SimHost. `installArenaRoom` is the
 *  fight; this lends it the shard's bodies, door collider and reward. Only a net room installs it: a tape's or a page's
 *  host has no such fight, so a one-player save keeps its adapters. */
import { pageBoss } from '../../../shared/game/plugin/bossRecord';
import * as v from 'valibot';
import type { BossSaved } from '@wildshard/engine/ai/BossBrain';
import type { AnimalSimSpec } from '@wildshard/engine/entities/AnimalSim';
import { isArenaSeal } from '../../../shared/game/boss/arenaCollision';
import type { SimHost, SimSpawn } from '@wildshard/engine/sim';
import type { SimSnapshot } from '@wildshard/engine/sim/snapshot';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { pickPrompt } from '@wildshard/engine/world/interact/prompts';
import type { EncounterReward } from '@wildshard/engine/sim/encounterRows';
import { installArenaRoom, type ArenaRoomBody } from './arenaRoomNative';
import { ArenaFightPageSchema, ArenaRoomSchema } from '../../../shared/game/boss/arenaRoomRows';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { nativePopulationOf } from '../riding/nativePopulation';
import { slotsOf } from './slotsNative';
import type { readEncounterPoses } from '../population/encounterBook';
import { attachNativeCreaturePose, type NativeCreaturePose } from '../../../shared/game/plugin/animation';

const Entry = v.object({ room: v.unknown(), encounter: v.object({ definition: v.record(v.string(), v.unknown()), page: v.unknown(), portal: v.unknown(), program: v.unknown() }) });
/** How far a press reaches the orb, and the eye it's judged from. */
const ORB_REACH = 2.6, ORB_EYE = 1.68;
const entered = new WeakMap<SimHost, ReturnType<typeof installArenaRoom<ArenaRoomBody>>>();
/** The row that places this fight. */
export interface ArenaEntryRow { readonly id: string; readonly body: { readonly kind: string; readonly variant: string }; readonly reward: string; readonly entrance: readonly [number, number, number, number] }
/** What a shard lends. */
export interface ArenaEntryPorts {
  readonly spec: (kind: string, variant: string) => AnimalSimSpec;
  readonly poses?: Awaited<ReturnType<typeof readEncounterPoses>>;
  readonly grantItem: (player: string, item: string, count: number) => void;
  /** The restored save, whose dynamic actors go back before its adapters do. */
  readonly snapshot?: Readonly<Omit<SimSnapshot, 'physics'>> | undefined;
}

const Species = v.object({ species: v.array(v.object({ kind: v.string(), aggressive: v.boolean(), lockable: v.optional(v.boolean()), dims: v.record(v.string(), v.unknown()),
  variants: v.array(v.object({ id: v.string(), label: v.string(), rarity: v.string(), hp: v.number(), mods: v.optional(v.record(v.string(), v.unknown())) })) })) });
/** A room's bodies by kind and variant, from the server's own species rows. */
export function arenaSpecies(input: unknown): ArenaEntryPorts['spec'] {
  const { species } = v.parse(Species, input);
  return (kind, variant) => {
    const row = species.find(entry => entry.kind === kind), selected = row?.variants.find(entry => entry.id === variant);
    if (row === undefined || selected === undefined) throw new Error(`Arena body ${kind}.${variant} has no species row`);
    const spec: unknown = { kind, label: selected.label, variant, rarity: selected.rarity, hp: selected.hp, aggressive: row.aggressive, dims: row.dims, mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 1, relentless: false, ...selected.mods }, ...(row.lockable === undefined ? {} : { lockable: row.lockable }) };
    return spec as AnimalSimSpec;
  };
}

/** Install one arena room. Its record lives in plain flags, as a boss row's does. */
export function installArenaEntry(host: SimHost, input: unknown, row: ArenaEntryRow, ports: ArenaEntryPorts): ReturnType<typeof installArenaRoom<ArenaRoomBody>> {
  const data = v.parse(Entry, input), room = v.parse(ArenaRoomSchema, data.room), page = v.parse(ArenaFightPageSchema, data.encounter.page), { add } = page;
  const poses = new Map<string, NativeCreaturePose>(), animations = ports.poses?.animations((x, z) => host.groundHeightAt(x, z));
  for (const saved of ports.snapshot?.adapters ?? []) {
    if (!saved.id.startsWith(`runtime.actor.${row.id}.`) || typeof saved.state !== 'string') continue;
    const recipe: unknown = JSON.parse(saved.state);
    host.spawn(recipe as SimSpawn);
  }
  const flag = (name: string): string => `boss.${row.id}.${name}`, paged = pageBoss(host, String(data.encounter.definition['id']));
  if (paged?.defeated === true) host.flags.set(flag('defeated'));
  if (paged?.rewardTaken === true) host.flags.set(flag('paid'));
  const savedFlags = ports.snapshot?.flags;
  const saved: BossSaved = { defeated: savedFlags?.includes(flag('defeated')) ?? host.flags.has(flag('defeated')),
    rewardTaken: savedFlags?.includes(flag('paid')) ?? host.flags.has(flag('paid')), kills: paged?.kills ?? 0 };
  const body = (id: string): ArenaRoomBody | null => {
    const actor = host.entities.get(id); if (actor === undefined) return null;
    if (ports.poses !== undefined && actor.kind === row.body.kind && !poses.has(id)) {
      const recipe = ports.poses.rows.find(value => value.kind === actor.kind && value.variant === actor.variant), animate = animations?.get(actor.kind);
      if (recipe === undefined || animate === undefined) throw new Error('Arena body lost its admitted contact pose');
      poses.set(id, attachNativeCreaturePose(actor, recipe.pose, animate).pose);
    }
    return actor as ArenaRoomBody;
  };
  const spawn = (id: string, kind: string, variant: string, x: number, z: number, yaw: number): ArenaRoomBody => {
    const held = body(id); if (held !== null) { held.place(x, z, yaw); return held; }
    host.spawn({ id, spec: ports.spec(kind, variant), seed: host.level.seed, scale: 1, at: { x, y: room.origin.y, z }, yaw });
    const actor = body(id); if (actor === null) throw new Error('Arena body was not spawned'); actor.hidden = false; return actor;
  };
  let door: (() => void) | null = null;
  const seal = (on: boolean): void => {
    door ??= (): void => undefined;
    for (const collider of host.physics.world.colliders.getAll()) if (isArenaSeal(collider, room) && collider.isEnabled() !== on) collider.setEnabled(on);
  };
  const [x, , z, facing] = row.entrance, { encounter } = data, [ox, oy, oz] = page.reward, orbAt = { x: ox, y: oy, z: oz };
  // A save holds the flags, so the orb an earner left is back on its pedestal.
  let orb: EncounterReward | null = saved.defeated && !saved.rewardTaken ? orbAt : null;
  const fight = installArenaRoom<ArenaRoomBody>(host, { step: row.id, room, definition: { ...encounter.definition, reward: {} } as Parameters<typeof installArenaRoom>[1]['definition'], fight: page,
    portal: { rows: v.parse(v.looseObject({}), encounter.portal) as NonNullable<Parameters<typeof installArenaRoom>[1]['portal']>['rows'], program: ReturnProgram.native(host, encounter.program),
      entrance: { x, y: host.groundHeightAt(x, z) + 0.1, z, facing } } }, {
    spawnBody: () => spawn(`${row.id}.body`, row.body.kind, row.body.variant, room.origin.x, room.origin.z, 0),
    spawnAdd: (_index, ax, az, yaw) => {
      const population = nativePopulationOf(host), slots = slotsOf(host);
      if (population === undefined || slots === undefined) throw new Error('Arena adds need their native species owner');
      population.validateSpawn(add.kind, add.variant);
      const actor = population.spawnElite(add.kind, ax, az, yaw, add.variant);
      Object.assign(actor.mem, add.memory); slots.adopt(actor);
      return Object.assign(actor, { hidden: false });
    },
    retire: actor => {
      const member = nativePopulationOf(host)?.bodies.find(candidate => candidate === actor);
      if (actor.kind === add.kind && member !== undefined) {
        const slots = slotsOf(host); if (slots === undefined) throw new Error('Arena add lost its native species owner');
        slots.release(member); return;
      }
      actor.hidden = true;
    }, find: id => body(id), seal, saved,
    // SC10 (J328): back to not beaten only when a served world's King stands again: the world's flags clear and the orb goes with them
    persist: value => {
      if (!value.defeated) { host.flags.clear(flag('defeated')); host.flags.clear(flag('paid')); orb = null; return; }
      host.flags.set(flag('defeated')); if (value.rewardTaken) host.flags.set(flag('paid'));
    },
    // a lone player earned it alone; a room's earners come from the book at the killing blow
    spawnReward: () => { if (!fight.bounty.room) fight.bounty.award([...host.players.keys()]); orb = orbAt; }, rewardPoint: () => orb,
    ...(ports.poses === undefined ? {} : { poses: {
      snapshot: () => [...poses].map(([id, pose]) => [id, pose.snapshot()]), restore: (value: unknown) => {
        const restored = v.parse(v.array(v.tuple([v.string(), v.string()])), value);
        if (restored.length !== poses.size || new Set(restored.map(([id]) => id)).size !== restored.length || restored.some(([id]) => !poses.has(id)))
          throw new Error('Arena pose continuation lost its body');
        for (const [id, wire] of restored) poses.get(id)?.restore(wire);
      },
    } }) });
  // J105: the orb on the pedestal is each earner's own, through the ledger, and it stands until the last of them has taken theirs.
  const pressed = new Set<string>();
  actRoutes(host).claims.set(`${fight.boss.def.id}.reward`, player => { pressed.add(player); });
  host.onStep(`${row.id}.reward`, () => {
    for (const player of pressed) {
      const feet = host.players.get(player)?.position;
      if (orb === null || feet === undefined || pickPrompt([{ position: orb, radius: ORB_REACH }], { x: feet.x, y: feet.y + ORB_EYE, z: feet.z }, host.physics) === undefined || !fight.bounty.take(player)) continue;
      ports.grantItem(player, row.reward, 1);
      if (fight.bounty.owed.length === 0) { orb = null; host.flags.set(flag('paid')); }
    }
    pressed.clear();
  });
  if (ports.poses !== undefined) host.onStep(`${row.id}.poses`, () => {
    for (const [id, pose] of poses) {
      const actor = host.entities.get(id); if (actor === undefined) throw new Error('Arena pose lost its body');
      const dt = host.bodyDt(id); if (dt <= 0) continue;
      pose.advance(dt, host.clock.now, true); pose.publish();
    }
  }, undefined, 'afterBodies');
  entered.set(host, fight);
  return fight;
}
/** This host's room fight, once installed. */
export function arenaEntryOf(host: SimHost): ReturnType<typeof installArenaRoom<ArenaRoomBody>> | undefined { return entered.get(host); }
