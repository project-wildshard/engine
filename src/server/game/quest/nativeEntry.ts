import type { SimHost, SimValue } from '@wildshard/engine/sim';
import type { InteractTable } from '@wildshard/engine/world/interact/types';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { NativeInventory } from '../../../shared/game/inventoryLaw';
import { ItemCatalogue } from '../../../shared/game/loadout/itemCatalogue';
import { bindQuestTableSpots } from '../../../shared/game/plugin/quests';
import { installDeclaredQuestHost, type QuestHostPorts } from '../plugin/simulation';
import { nativeQuestInputs } from './nativeInputs';
import { AchievementCounterBook, type AchievementCounterRows } from '../../../shared/game/achievements';
import * as v from 'valibot';
import { bindInteractionTransitions, type Flags, type InteractionState, type InteractionTransitions } from '@wildshard/engine/world/interact/flags';
import { plateOverlap } from '@wildshard/engine/world/interact/barrel';
import { walkInPickup } from '@wildshard/engine/world/interact/pickup';
import { isJsonData } from '@wildshard/format/json';
import { questBooks } from '@wildshard/engine/quest/players';

type NativeQuestOwners = Omit<QuestHostPorts, 'spots' | 'commands' | 'fact' | 'coins'> & { readonly spots?: QuestHostPorts['spots'] };
type NativeQuestRule<Spot> = InteractionState & { readonly spot: Spot };
/** One player at the quest's table: what it may open, take and carry. */
export interface NativeQuestSeat<Spot> {
  readonly flags: Flags; readonly pack: NativeInventory<string>; readonly rules: ReadonlyMap<string, NativeQuestRule<Spot>>;
  readonly transitions: InteractionTransitions<NativeQuestRule<Spot>>;
}
/** Every flag a table row raises on the player who uses it. A plate is the world's: anyone's weight holds it down. */
function rowFlags(row: InteractionState): string[] {
  return [...row.auto === null ? [] : [row.auto], ...row.sets, ...row.gives, row.taken, row.open, row.lit, row.used, row.lever,
    ...row.contents.flatMap(grant => grant.kind === 'flag' ? [grant.id] : [])];
}
const finite = v.pipe(v.number(), v.finite()), positive = v.pipe(finite, v.minValue(Number.MIN_VALUE));
const transitionRows = v.strictObject({ ids: v.pipe(v.array(v.string()), v.maxLength(1024)),
  rowLimit: v.pipe(finite, v.integer(), v.minValue(1), v.maxValue(1024)), flagLimit: v.pipe(finite, v.integer(), v.minValue(1), v.maxValue(1024)),
  touch: v.picklist(['direct', 'graph']), pickup: v.union([v.literal('walk-in'), v.strictObject({ radius: positive, height: positive })]),
  plate: v.exactOptional(v.strictObject({ inset: finite, depth: finite })),
});
const transitionSpot = v.object({ x: finite, y: finite, z: finite, yaw: finite });

/** The existing saved counter book with its actual native ledger owner. */
interface NativeQuestAchievements extends AchievementCounterBook {
  readonly flush: () => void; readonly sync: () => void; readonly observe: () => void;
}

/** Renderer-free entry over the admitted inventory/table and existing worker
 * command and ledger owners. Composition lends only actual platform mechanics
 * at its original graph-install phase; author input stays rows and identities. */
export function prepareNativeQuestEntry<Spot extends { readonly id: string; readonly kind: string }>(
  host: SimHost, source: Shardfile, table: InteractTable, spots: readonly Spot[],
  bounds: Parameters<typeof bindQuestTableSpots>[3] = {},
  savedNames: Readonly<Record<string, string>> = {},
): {
  readonly saved: {
    readonly encode: (value: Record<string, SimValue>) => Record<string, SimValue>;
    readonly decode: (value: unknown) => Record<string, unknown>;
  };
  readonly input: ReturnType<typeof nativeQuestInputs>; readonly inventory: ItemCatalogue['inventory'];
  readonly rules: ReturnType<typeof bindQuestTableSpots<Spot>>; readonly pack: NativeInventory<string>;
  readonly achievements: (rows: AchievementCounterRows, initial?: Readonly<Record<string, number>>) => NativeQuestAchievements;
  readonly transitions: (rows: unknown) => InteractionTransitions<NativeQuestRule<Spot>>;
  /** Another player's rules, pack and transitions over its own book. */
  readonly seat: (player: string, rows: unknown) => NativeQuestSeat<Spot>;
  readonly install: (owners?: NativeQuestOwners) => ReturnType<typeof installDeclaredQuestHost>;
} {
  const books = questBooks(host);
  if (host.scope.disposed) throw new Error('Native quest entry left before preparation');
  const input = nativeQuestInputs(host), inventory = new ItemCatalogue(source.items).inventory;
  const rules = bindQuestTableSpots(table, spots, host.flags, bounds), pack = new NativeInventory(inventory, host);
  books.claim([...rules.values()].flatMap(rowFlags)); books.show([...rules.values()].flatMap(rowFlags));
  let installed = false, graph: ReturnType<typeof installDeclaredQuestHost> | null = null;
  const transitionsOver = (data: unknown, owned: typeof rules, flags: Flags, own: NativeInventory<string>, player: string): InteractionTransitions<NativeQuestRule<Spot>> => {
    if (host.scope.disposed || !isJsonData(data)) throw new Error('Native transitions require live JSON rows');
    const rows = v.parse(transitionRows, data), selected = rows.ids.map(id => {
      const rule = owned.get(id); if (rule === undefined) throw new Error(`Unknown native transition row ${id}`); return rule;
    });
    const positions = new Map(selected.map(rule => [rule.d.id, v.parse(transitionSpot, rule.spot)]));
    const at = (row: NativeQuestRule<Spot>) => {
      const position = positions.get(row.d.id); if (position === undefined) throw new Error('Missing native transition position'); return position;
    };
    return bindInteractionTransitions(selected, flags, { rowLimit: rows.rowLimit, flagLimit: rows.flagLimit, touch: rows.touch,
      commit: id => { if (graph === null) throw new Error('Native quest graph is not installed'); return graph.run(id, undefined, player); },
      item: (id, n) => { own.add(id, n); },
      ...(rows.plate === undefined ? {} : { plate: (row: NativeQuestRule<Spot>, size: number) => plateOverlap(host.physics, at(row), at(row).yaw, size, rows.plate) }),
      touched: row => {
        const feet = host.players.get(player)?.position, position = at(row), pickup = rows.pickup;
        if (feet === undefined) return false;
        if (pickup === 'walk-in') return walkInPickup(host.physics, feet, position);
        const dx = feet.x - position.x, dz = feet.z - position.z;
        return dx * dx + dz * dz < pickup.radius * pickup.radius && Math.abs(feet.y - position.y) < pickup.height;
      },
    });
  };
  return { input, inventory, rules, pack,
    saved: {
      encode: value => Object.fromEntries(Object.entries(value).map(([key, saved]) => [savedNames[key] ?? key, saved])),
      decode: value => {
        if (Array.isArray(value)) throw new TypeError('Native saved envelope requires an object');
        const envelope = v.parse(v.record(v.string(), v.unknown()), value);
        const names = new Map(Object.entries(savedNames).map(([key, name]) => [name, key]));
        const seen = new Set<string>();
        return Object.fromEntries(Object.entries(envelope).map(([key, saved]) => {
          const role = names.get(key) ?? key;
          if ((savedNames[role] ?? role) !== key || seen.has(role)) throw new TypeError('Non-canonical native saved key');
          seen.add(role); return [role, saved];
        }));
      },
    },
    transitions: data => transitionsOver(data, rules, host.flags, pack, books.lead.player),
    seat: (player, data) => {
      const { flags } = books.of(player), owned = bindQuestTableSpots(table, spots, flags, bounds), own = new NativeInventory(inventory);
      return { flags, pack: own, rules: owned, transitions: transitionsOver(data, owned, flags, own, player) };
    },
    achievements: (rows, initial = {}): NativeQuestAchievements => {
      const book = new AchievementCounterBook(rows, initial);
      const flush = (): void => {
        const facts = book.takeFacts();
        for (let i = 0; i < 1048576; i++) { const row = facts[i]; if (row === undefined) break; input.ledger.fact(row.fact, row.entity); }
      };
      const sync = (): void => { book.counters.syncFlags(host.flags); flush(); };
      return Object.assign(book, { flush, sync, observe: (): void => {
        host.scope.onDispose(host.flags.onChange((flag, on) => { if (on && !flag.startsWith('plate:') && !flag.startsWith('lever:')) sync(); }));
      } });
    },
    install: (owners: NativeQuestOwners = {}): ReturnType<typeof installDeclaredQuestHost> => {
      if (installed || host.scope.disposed) throw new Error('Native quest entry already installed or disposed');
      installed = true;
      graph = installDeclaredQuestHost(host, source, { ...owners, spots: owners.spots ?? { interact: [], crack: [] },
        commands: input.scripts, fact: input.ledger.fact, coins: input.ledger.coins });
      return graph;
    } };
}
