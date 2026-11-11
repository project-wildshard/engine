// SR11 (C8, C9): a data shard's declared kit melee and lantern on the server. Before the flip the page stepped each item's
// runtime; the flip left that runtime queued and never stepped, so a data shard's player struck with the zero-damage
// HOST_PROBE and the lantern never lit. Each player now holds their own runtimes here, fed by their wire: a press with its
// aim, a held heavy, an equip by slot and a lantern scene. What the lantern burns reaches its owner as owned lines.
import { Vector3 } from 'three';
import type { NetCommand } from '@wildshard/wire/netCommand';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { NET_BUTTONS } from '@wildshard/engine/input/netButtons';
import { ItemRuntime, type ItemHook, type ItemState, type ItemTarget } from '@wildshard/engine/combat/items';
import type { AimCommand } from '@wildshard/engine/input/commands';
import type { SimHost, SimValue } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { publishOwned } from '@wildshard/engine/sim/shardRows';
import { declaredKitSlots, SERVER_KIT_FAMILIES } from '../../../shared/game/shardfile/items';
import { playerSeats, type PlayerSeat } from '../plugin/playerSeats';

/** The page's canonical eye above the feet (`Player.sampleAimCommand`). */
const EYE = 1.68;
/** Oil reaches a page in thousandths: a line changes about every eighth of a second on a two-minute lantern, not every tick. */
const FUEL_STEPS = 1000;

/** What a data cell hands this owner each tick, before the host steps. */
export interface DeclaredKitItems {
  /** One player's command for this tick. False: it named nothing this owner takes. */
  readonly command: (player: string, command: NetCommand) => void;
  /** An `equip` act's slot. False: no declared kit weapon goes by it. */
  readonly equip: (player: string, slot: number) => boolean;
  /** An `interact` act naming a lantern scene. False: the id is no item scene, and the cell judges it as a prompt. */
  readonly scene: (player: string, id: string) => boolean;
}
interface KitSeat extends PlayerSeat { readonly runtimes: ReadonlyMap<string, ItemRuntime> }

const finite = (aim: AimCommand): boolean => [aim.origin.x, aim.origin.y, aim.origin.z, aim.direction.x, aim.direction.y, aim.direction.z].every(Number.isFinite);
function isStates(value: unknown): value is Record<string, ItemState> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

/** Install a data shard's kit items, a seat for each player; null when the shard declares none. */
export function installDeclaredKitItems(host: SimHost, shard: Pick<Shardfile, 'items' | 'targets' | 'state'>, hooks: (player: string) => ReadonlyMap<string, ItemHook>): DeclaredKitItems | null {
  const rows = shard.items.rows.filter(row => SERVER_KIT_FAMILIES.has(row.family));
  if (rows.length === 0) return null;
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
    const own = hooks(player.id), runtimes = new Map(rows.map(row => [row.id, new ItemRuntime(row, {
      actor: player.health, combat, targets, hook: own.get(row.id) ?? null,
      // Status effects have no server owner yet: the blow lands, its effect does not (the page's EffectService was its only one).
      effect: () => undefined, active: () => player.health.alive,
    })] as const));
    return { runtimes,
      step: dt => { for (const runtime of runtimes.values()) runtime.step(host.state.tick, dt); },
      snapshot: (): SimValue => Object.fromEntries([...runtimes].map(([id, runtime]) => [id, runtime.snapshot()])) as unknown as SimValue,
      restore: value => {
        if (!isStates(value)) throw new Error('Invalid declared kit item continuation');
        // A player's document can come from an older room (E7.4): its tick is that room's. The runtime's tick only orders steps,
        // so it never stands ahead of this host's.
        for (const [id, runtime] of runtimes) { const saved = value[id]; if (saved !== undefined) runtime.restore({ ...saved, tick: Math.max(-1, Math.min(saved.tick, host.state.tick - 1)) }); }
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
  const held = (player: PlayerSim): ItemRuntime | undefined => { const id = weapons[player.held]; return id === undefined ? undefined : seats.of(player).runtimes.get(id); };
  const eye = (player: PlayerSim, pitch: number): AimCommand => {
    const cos = Math.cos(pitch);
    return { origin: { x: player.position.x, y: player.position.y + EYE, z: player.position.z }, direction: { x: -Math.sin(player.yaw) * cos, y: Math.sin(pitch), z: -Math.cos(player.yaw) * cos } };
  };
  // An input may not end the server: a request the runtime refuses (a full queue, a bad aim) is dropped.
  const safely = (run: () => void): void => { try { run(); } catch (error) { if (!(error instanceof RangeError)) throw error; } };
  return {
    command: (id, command) => {
      const player = host.players.get(id), runtime = player === undefined ? undefined : held(player);
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
      const player = host.players.get(id);
      if (player === undefined || weapons[slot] === undefined) return false;
      const before = held(player), aim = eye(player, 0);
      if (before !== undefined) safely(() => { before.hold(false, aim, false); }); // a swap lets go of a charge without striking
      player.held = slot; return true;
    },
    scene: (id, scene) => {
      const row = scenes.get(scene); if (row === undefined) return false;
      const player = host.players.get(id), runtime = player === undefined ? undefined : seats.of(player).runtimes.get(row.item);
      if (runtime !== undefined) safely(() => { runtime.queue(row.action); });
      return true;
    },
  };
}
