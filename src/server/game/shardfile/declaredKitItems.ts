// SR11 (C8, C9): a data shard's declared kit melee and lantern on the server. Before the flip the page stepped each item's
// runtime; the flip left that runtime queued and never stepped, so a data shard's player struck with the zero-damage
// HOST_PROBE and the lantern never lit. Each player now holds their own runtimes here, fed by their wire: a press with its
// aim, a held heavy, an equip by slot and a lantern scene. What the lantern burns reaches its owner as owned lines.
// TE-ENG2: a declared lever-action (`kit.lever`) is a seat here too: Pine's per-round cycle (`RangedAction.Cycle`) and a hitscan
// along the wire's aim at any body the host holds, population, declared enemies or posts alike. It starts locked; an item scene
// (a rack's prompt) takes it, and what it holds reaches its owner as owned lines (`leverLines`).
import { Vector3 } from 'three';
import * as v from 'valibot';
import type { NetCommand } from '@wildshard/wire/netCommand';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { NET_BUTTONS } from '@wildshard/engine/input/netButtons';
import { ItemRuntime, type ItemHook, type ItemState, type ItemTarget } from '@wildshard/engine/combat/items';
import { RangedAction } from '@wildshard/engine/combat/Firearm';
import { worldHit } from '@wildshard/engine/physics/query';
import { shotRandom, shotSpread } from '@wildshard/engine/combat/shotSpread';
import type { AimCommand } from '@wildshard/engine/input/commands';
import type { SimHost, SimValue } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { publishOwned } from '@wildshard/engine/sim/shardRows';
import { declaredKitSlots, LEVER_FAMILY, leverLines, leverProfile, SERVER_KIT_FAMILIES, type LeverProfile } from '../../../shared/game/shardfile/items';
import { playerSeats, type PlayerSeat } from '../plugin/playerSeats';
import { nativeRangedHit } from '../plugin/nativeItems';

/** The page's canonical eye above the feet (`Player.sampleAimCommand`). */
const EYE = 1.68;
/** Oil reaches a page in thousandths: a line changes about every eighth of a second on a two-minute lantern, not every tick. */
const FUEL_STEPS = 1000;
/** How far past a prompt's own radius a take holds: the page saw the prompt a frame ago, and the server is a command behind. */
const PROMPT_SLACK = 1.5;

/** What a data cell hands this owner each tick, before the host steps. */
export interface DeclaredKitItems {
  /** One player's command for this tick. False: it named nothing this owner takes. */
  readonly command: (player: string, command: NetCommand) => void;
  /** An `equip` act's slot. False: no declared kit weapon goes by it. */
  readonly equip: (player: string, slot: number) => boolean;
  /** An `interact` act naming an item scene: a lantern's toggle or refill, a lever's take or reload. False: the id is no item scene, and the cell judges it as a prompt. */
  readonly scene: (player: string, id: string) => boolean;
  /** A `reload` act for a held slot. False: no declared lever goes by it. */
  readonly reload: (player: string, slot: number) => boolean;
}
type Cycle = InstanceType<typeof RangedAction.Cycle>;
/** One player's lever: the cycle and its reserve, whether they have taken it, and the time since a dry pull (its auto-reload window). */
interface LeverSeat { readonly act: Cycle; readonly store: { reserve: number }; taken: boolean; sinceEmpty: number }
interface KitSeat extends PlayerSeat { readonly runtimes: ReadonlyMap<string, ItemRuntime>; readonly levers: ReadonlyMap<string, LeverSeat> }
type LeverRow = Extract<Shardfile['items']['rows'][number], { kind: 'weapon' }>;
const finiteNumber = v.pipe(v.number(), v.finite()), count = v.pipe(finiteNumber, v.integer(), v.minValue(0));
const LeverSaved = v.strictObject({ tube: count, chambered: v.boolean(), caseInChamber: v.boolean(), hammerCocked: v.boolean(),
  phase: v.picklist(['idle', 'beat', 'cycle', 'reload']), phaseT: finiteNumber, fed: count, planned: count, stopAfter: v.boolean(), dryAtStart: v.boolean(),
  reloadProgress: finiteNumber, reserve: count, sinceEmpty: finiteNumber, taken: v.boolean() });
function leverSnapshot(seat: LeverSeat): v.InferOutput<typeof LeverSaved> {
  const { act } = seat;
  return { tube: act.tube, chambered: act.chambered, caseInChamber: act.caseInChamber, hammerCocked: act.hammerCocked, phase: act.phase, phaseT: act.phaseT,
    fed: act.fed, planned: act.planned, stopAfter: act.stopAfter, dryAtStart: act.dryAtStart, reloadProgress: act.reloadProgress, reserve: seat.store.reserve, sinceEmpty: seat.sinceEmpty, taken: seat.taken };
}
function restoreLever(seat: LeverSeat, value: unknown): void {
  const s = v.parse(LeverSaved, value);
  if (s.tube > seat.act.tubeMax) throw new Error('Invalid declared lever continuation');
  Object.assign(seat.act, { tube: s.tube, chambered: s.chambered, caseInChamber: s.caseInChamber, hammerCocked: s.hammerCocked, phase: s.phase, phaseT: s.phaseT,
    fed: s.fed, planned: s.planned, stopAfter: s.stopAfter, dryAtStart: s.dryAtStart, reloadProgress: s.reloadProgress });
  seat.store.reserve = s.reserve; seat.sinceEmpty = s.sinceEmpty; seat.taken = s.taken;
}

const finite = (aim: AimCommand): boolean => [aim.origin.x, aim.origin.y, aim.origin.z, aim.direction.x, aim.direction.y, aim.direction.z].every(Number.isFinite);
function isStates(value: unknown): value is Record<string, ItemState> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

/** Install a data shard's kit items, a seat for each player; null when the shard declares none. */
export function installDeclaredKitItems(host: SimHost, shard: Pick<Shardfile, 'items' | 'targets' | 'state'>, hooks: (player: string) => ReadonlyMap<string, ItemHook>): DeclaredKitItems | null {
  const rows = shard.items.rows.filter(row => SERVER_KIT_FAMILIES.has(row.family));
  if (rows.length === 0) return null;
  const levers = new Map<string, { readonly row: LeverRow; readonly profile: LeverProfile; readonly lines: ReturnType<typeof leverLines> }>(rows.flatMap(row => row.kind === 'weapon' && row.family === LEVER_FAMILY ? [[row.id, { row, profile: leverProfile(row), lines: leverLines(row.id) }] as const] : []));
  const runtimeRows = rows.filter(row => !levers.has(row.id));
  // A scene a prompt runs is taken only near that prompt: a page may name the scene, but the server judges where its player stands.
  const prompts = new Map<string, { readonly at: readonly [number, number, number]; readonly radius: number }[]>();
  for (const row of shard.targets.interactions) prompts.set(row.scene, [...(prompts.get(row.scene) ?? []), row]);
  // A rack's prompt names its lever's scene: the page sends the prompt's own id, and this kit runs it, not a script (a shard may have none).
  const leverPrompts = new Map(shard.targets.interactions.flatMap(row => (shard.targets.itemActions ?? []).some(action => action.scene === row.scene && levers.has(action.item)) ? [[row.id, row.scene] as const] : []));
  const slots = declaredKitSlots(shard.items.rows), weapons = [...slots.keys()];
  const scenes = new Map((shard.targets.itemActions ?? []).filter(row => rows.some(item => item.id === row.item)).map(row => [row.scene, row] as const));
  const fields = (shard.targets.itemFields ?? []).flatMap(row => {
    const field = shard.state.player.find(entry => entry.id === row.fieldId);
    return field === undefined || field.privacy === 'host' ? [] : [{ item: row.item, name: field.name, property: row.property }];
  });
  const targets = (): readonly ItemTarget[] => [...host.entities.values()].flatMap(actor => {
    if (!actor.alive) return [];
    const target = host.combat.targetPort(actor.combatActor(), actor, velocity => { actor.impulse(velocity); });
    return [{ actor: target.actor, position: target.position, target: target.target, hittable: target.hittable, hurt: target.hurt,
      aimPoint: new Vector3(actor.position.x, actor.position.y + actor.dims.bodyY * actor.scale, actor.position.z) }];
  });
  // The command a blow answers: the page confirms its own hits by it, as it does a native swing's (`attackSeq`).
  const pressed = new Map<string, number>();
  const seats = playerSeats<KitSeat>(host, (player: PlayerSim) => {
    const combat = { hit: (request: Parameters<SimHost['combat']['hit']>[0]): ReturnType<SimHost['combat']['hit']> => host.combat.hit({ ...request, attackSeq: pressed.get(player.id) ?? 0 }) };
    const own = hooks(player.id), runtimes = new Map(runtimeRows.map(row => [row.id, new ItemRuntime(row, {
      actor: player.health, combat, targets, hook: own.get(row.id) ?? null,
      // Status effects have no server owner yet: the blow lands, its effect does not (the page's EffectService was its only one).
      effect: () => undefined, active: () => player.health.alive,
    })] as const));
    const seated = new Map([...levers].map(([id, { profile }]) => {
      const store = { reserve: profile.reserve };
      const seat: LeverSeat = { act: new RangedAction.Cycle(store, { magazine: profile.magazine, reload: profile.reload, ...profile.lever }), store, taken: false, sinceEmpty: 99 };
      return [id, seat] as const;
    }));
    return { runtimes, levers: seated,
      step: dt => {
        for (const runtime of runtimes.values()) runtime.step(host.state.tick, dt);
        const holding = weapons[player.held];
        for (const [id, seat] of seated) {
          const lever = levers.get(id); if (lever === undefined) continue;
          seat.sinceEmpty += dt;
          // Pine's window: an empty gun in hand starts its own reload a beat after the dry pull, and only within its close.
          const due = seat.taken && holding === id && seat.act.wantsAutoReload && seat.sinceEmpty > lever.profile.autoReload && seat.sinceEmpty < lever.profile.lever.autoReloadClose;
          for (const _event of seat.act.events(dt, due)) { /* The seat has no presentation: the page plays its own cycle. */ }
        }
      },
      snapshot: (): SimValue => ({ ...Object.fromEntries([...runtimes].map(([id, runtime]) => [id, runtime.snapshot()])), ...Object.fromEntries([...seated].map(([id, seat]) => [id, leverSnapshot(seat)])) }) as unknown as SimValue,
      restore: value => {
        if (!isStates(value)) throw new Error('Invalid declared kit item continuation');
        // A player's document can come from an older room (E7.4): its tick is that room's. The runtime's tick only orders steps,
        // so it never stands ahead of this host's.
        for (const [id, runtime] of runtimes) { const saved = value[id]; if (saved !== undefined) runtime.restore({ ...saved, tick: Math.max(-1, Math.min(saved.tick, host.state.tick - 1)) }); }
        // A save made before a lever existed leaves it fresh.
        for (const [id, seat] of seated) { const saved: unknown = value[id]; if (saved !== undefined) restoreLever(seat, saved); }
      } };
  });
  // Joined: a save made before this owner existed restores, and its items start fresh.
  host.onStep('items.declared-kit', dt => { for (const id of pressed.keys()) if (!host.players.has(id)) pressed.delete(id); seats.step(dt); }, { ...seats.adapter, joined: true });
  if (fields.length > 0) publishOwned(host, 'items.declared-kit', (id, out) => {
    const player = host.players.get(id); if (player === undefined) return;
    const { runtimes } = seats.of(player);
    for (const field of fields) {
      const runtime = runtimes.get(field.item); if (runtime === undefined) continue;
      out.set(field.name, field.property === 'fuel' ? Math.round(runtime.remainingFuel * FUEL_STEPS) / FUEL_STEPS : Number(runtime.lightOn));
    }
  });
  if (levers.size > 0) publishOwned(host, 'items.declared-lever', (id, out) => {
    const player = host.players.get(id); if (player === undefined) return;
    for (const [item, seat] of seats.of(player).levers) {
      const lines = levers.get(item)?.lines; if (lines === undefined) continue;
      out.set(lines.rounds, seat.act.rounds); out.set(lines.reserve, seat.store.reserve);
      out.set(lines.reloading, Number(seat.act.phase === 'reload')); out.set(lines.taken, Number(seat.taken));
    }
  });
  const held = (player: PlayerSim): ItemRuntime | undefined => { const id = weapons[player.held]; return id === undefined ? undefined : seats.of(player).runtimes.get(id); };
  const heldLever = (player: PlayerSim): { readonly seat: LeverSeat; readonly row: LeverRow; readonly profile: LeverProfile } | undefined => {
    const id = weapons[player.held], lever = id === undefined ? undefined : levers.get(id), seat = id === undefined ? undefined : seats.of(player).levers.get(id);
    return lever === undefined || seat === undefined ? undefined : { seat, row: lever.row, profile: lever.profile };
  };
  // A round leaves from where the server stands this player, along the page's look, and stops at the first body or wall.
  const eyeAt = new Vector3(), along = new Vector3(), end = new Vector3(), across = new Vector3();
  const hitscan = (player: PlayerSim, row: LeverRow, profile: LeverProfile, direction: AimCommand['direction'], seq: number): void => {
    eyeAt.set(player.position.x, player.position.y + EYE, player.position.z); along.set(direction.x, direction.y, direction.z).normalize();
    // The row's hip spread, drawn from the command's own seq as Pine's rounds are (P1-E5.3-E4), so a replay lands the same.
    if (profile.spreadHip > 0) shotSpread(along, profile.spreadHip * (Math.PI / 180), shotRandom(seq), { radius: profile.spreadRadius, axisScale: 1 }, across);
    const wall = worldHit(host.physics, eyeAt, end.copy(eyeAt).addScaledVector(along, profile.range), 0);
    const hit = nativeRangedHit([...host.entities.values()], eyeAt, along, wall === null ? profile.range : wall.distance), body = hit?.body ?? null;
    if (hit === null || body === null) return;
    host.combat.hit({ source: player.health, sourceTags: row.light.tags, target: body.combatActor(), amount: row.light.damage, from: eyeAt.clone(), point: hit.point.clone(),
      dir: along.clone(), weaponId: row.id, moveId: row.light.id, headshot: hit.head, attackSeq: seq });
  };
  // Pine's trigger (`cycleItem`): a chambered round fires; an empty chamber throws the lever, or starts a reload when the tube is dry too.
  const pull = (player: PlayerSim, lever: NonNullable<ReturnType<typeof heldLever>>, direction: AimCommand['direction'], seq: number): void => {
    const { seat } = lever, { act } = seat;
    if (!seat.taken || !player.health.alive) return;
    if (act.phase === 'reload') { act.triggerWhileReloading(); return; }
    if (act.phase !== 'idle') return;
    if (!act.chambered) { seat.sinceEmpty = 0; if (act.tube > 0) act.throwLever(); else act.beginReload(); return; }
    act.dropHammer();
    hitscan(player, lever.row, lever.profile, direction, seq);
  };
  const near = (player: PlayerSim, scene: string): boolean => {
    const spots = prompts.get(scene);
    return spots === undefined || spots.some(spot => Math.hypot(player.position.x - spot.at[0], player.position.z - spot.at[2]) <= spot.radius * PROMPT_SLACK);
  };
  const eye = (player: PlayerSim, pitch: number): AimCommand => {
    const cos = Math.cos(pitch);
    return { origin: { x: player.position.x, y: player.position.y + EYE, z: player.position.z }, direction: { x: -Math.sin(player.yaw) * cos, y: Math.sin(pitch), z: -Math.cos(player.yaw) * cos } };
  };
  // An input may not end the server: a request the runtime refuses (a full queue, a bad aim) is dropped.
  const safely = (run: () => void): void => { try { run(); } catch (error) { if (!(error instanceof RangeError)) throw error; } };
  return {
    command: (id, command) => {
      const shooter = host.players.get(id), lever = shooter === undefined ? undefined : heldLever(shooter);
      if (shooter !== undefined && lever !== undefined) {
        if (command.attack !== undefined && finite(command.attack.aim)) pull(shooter, lever, command.attack.aim.direction, command.seq);
        return;
      }
      const player = shooter, runtime = player === undefined ? undefined : held(player);
      if (player === undefined || runtime === undefined) return;
      const heavy = (command.buttons & NET_BUTTONS.heavy) !== 0, { attack } = command;
      if (attack !== undefined || runtime.snapshot().held !== heavy) pressed.set(id, command.seq);
      // A press strikes along the page's look, from where the server stands this player: a client names a direction, never a place.
      // A heavy press strikes heavy at once; a heavy held with no press charges, and its release strikes.
      if (attack !== undefined) {
        if (finite(attack.aim)) safely(() => { runtime.queue(heavy ? 2 : 1, { origin: eye(player, 0).origin, direction: attack.aim.direction }); });
        return;
      }
      const aim = eye(player, Number.isFinite(command.pitch) ? command.pitch : 0);
      safely(() => { runtime.hold(heavy, aim); });
    },
    equip: (id, slot) => {
      const player = host.players.get(id), want = weapons[slot];
      if (player === undefined || want === undefined) return false;
      // A lever still on its rack is no swap: the act is spent, and the hand stays where it is.
      if (seats.of(player).levers.get(want)?.taken === false) return true;
      const before = held(player), aim = eye(player, 0);
      if (before !== undefined) safely(() => { before.hold(false, aim, false); }); // a swap lets go of a charge without striking
      player.held = slot; return true;
    },
    scene: (id, named) => {
      const scene = leverPrompts.get(named) ?? named, row = scenes.get(scene); if (row === undefined) return false;
      const taker = host.players.get(id), lever = taker === undefined ? undefined : seats.of(taker).levers.get(row.item);
      if (taker !== undefined && lever !== undefined) {
        if (!near(taker, scene)) return true;
        // 3 takes the lever off its rack and into hand; 4 reloads it.
        if (row.action === 3) {
          const slot = weapons.indexOf(row.item), before = held(taker);
          if (before !== undefined) safely(() => { before.hold(false, eye(taker, 0), false); });
          lever.taken = true; if (slot !== -1) taker.held = slot;
        } else if (lever.taken) lever.act.beginReload();
        return true;
      }
      const player = taker, runtime = player === undefined ? undefined : seats.of(player).runtimes.get(row.item);
      if (runtime !== undefined) safely(() => { runtime.queue(row.action); });
      return true;
    },
    reload: (id, slot) => {
      const player = host.players.get(id), want = weapons[slot], seat = player === undefined || want === undefined ? undefined : seats.of(player).levers.get(want);
      if (player === undefined || seat === undefined) return false;
      if (seat.taken && player.held === slot) seat.act.beginReload();
      return true;
    },
  };
}
