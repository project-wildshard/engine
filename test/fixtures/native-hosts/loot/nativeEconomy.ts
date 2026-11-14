import * as v from 'valibot';
import { Scene } from 'three';
import type { SimHost, SimValue } from '@wildshard/engine/sim';
import type { ShardFolder } from '../../../../src/shared/game/shardfile/shardFolder';
import { CoinMotion } from '../../../../src/client/game/loot/CoinMotion';
import { readCoinBurstState } from '../../../../src/shared/game/loot/coinBurstState';
import { Owned, isOwnedId, isCosmetic } from '../../../../src/shared/game/loot/Owned';
import { Purse } from '../../../../src/shared/game/loot/Purse';
import { Bounty } from '../../../../src/shared/game/loot/Bounty';
import { Exchange } from '../../../../src/shared/game/loot/exchange';
import { DEATH_ORDER } from '../../../../src/shared/game/loot/deaths';
import { coinValue } from '../../../../src/shared/game/loot/coinAmounts';
import { WeightedTable } from '@wildshard/engine/ai/weighted';
import { readLootTables } from '../../../../src/shared/game/loot/tableRows';
import { declaredLootEconomy } from '../../../../src/shared/game/shard/declaredRows';
import { createHeadlessPromptPicker, type HeadlessPrompt } from '../../../../src/shared/game/quest/interactionRows';
import { nativeQuestInputs } from '../../../../src/server/game/quest/nativeInputs';
import type { MixedPopulationBody } from '@wildshard/engine/game/population/mixedRoster';
import { nativeQuestPromptRoster } from '@wildshard/engine/game/quest/nativeComposition';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const integer = v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0));
const counts = v.pipe(v.record(v.string(), integer), v.check(rows => Object.keys(rows).length <= 64));
const ownedRows = v.pipe(v.strictObject({ owned: v.array(v.string()), worn: v.array(v.string()) }),
  v.check(row => row.owned.every(isOwnedId) && row.worn.every(id => isOwnedId(id) && isCosmetic(id) && row.owned.includes(id))));
const savedState = v.strictObject({ version: v.literal(1), durable: integer,
  purse: v.strictObject({ coins: integer, unsaved: v.boolean() }), owned: ownedRows, paid: counts, caps: counts,
  burst: v.unknown(), modal: v.strictObject({ version: v.literal(1), open: v.boolean() }) });
export const NATIVE_TRADE = 'driftwood.trade';
const economies = new WeakMap<SimHost, ReturnType<typeof installNativeEconomy>>();
export function nativeEconomy(host: SimHost): ReturnType<typeof installNativeEconomy> {
  const economy = economies.get(host); if (economy === undefined || host.scope.disposed) throw new Error('Missing native economy'); return economy;
}

/** The page's actual purse, bounty, coin pool, ownership and exchange; only the
 * storage/RNG and command delivery belong to this fixed native fixture. */
export function installNativeEconomy(host: SimHost, product: ShardFolder, roster: () => readonly MixedPopulationBody[],
  questStep: string, closeDistance: number): { readonly purse: () => Purse; readonly owned: () => Owned; readonly exchange: Exchange; readonly coins: CoinMotion } {
  if (economies.has(host)) throw new Error('Native economy already installed');
  const rows = declaredLootEconomy(product.section('economy/loot').rows.loot);
  const coinRow = readLootTables(rows.tables).reverse().find(row => row.id === 'coins' || row.domain === 'coins');
  const coinTable = coinRow === undefined ? undefined : new WeightedTable(coinRow.table);
  let durable = 0, ownedSaved = { owned: [] as string[], worn: [] as string[] }, paid: Record<string, number> = {};
  let caps = Bounty.census(roster().map(body => ({ kind: body.kind, herd: body.herd, alive: body.actor?.alive ?? false })));
  const shard = product.shardfile.identity.slug;
  const purseSlot = { read: () => durable, write: (n: number) => { durable = n; return true; } };
  const ownedSlot = { read: () => structuredClone(ownedSaved), write: (value: typeof ownedSaved) => { ownedSaved = structuredClone(value); return true; } };
  const bountySlot = { read: () => ({ ...paid }), write: (value: Record<string, number>) => { paid = { ...value }; return true; } };
  let purse = new Purse(shard, purseSlot), owned = new Owned(shard, ownedSlot), bounty = new Bounty(shard, caps, bountySlot);
  const burst = new CoinMotion(new Scene(), () => host.rng.stream('cosmetic').next());
  const callbacks = { onCoin: (n: number) => { purse.add(n, false); }, onDone: () => { purse.flush(); } };
  const exchange = new Exchange(rows.exchange, new Map<string, unknown>([
    ['owned', { has: (id: string) => owned.has(id), grant: (id: string) => owned.grant(id) }],
    ['purse', { count: () => purse.coins, spend: (n: number) => purse.spend(n) }],
  ]));
  const prompts = nativeQuestPromptRoster(host, questStep), anonymous = prompts.filter(prompt => prompt.id === null);
  if (anonymous.length !== 1 || closeDistance <= 0 || !Number.isFinite(closeDistance)) throw new Error('Trade requires its actual page prompt and close distance');
  const original = anonymous[0]; if (original === undefined) throw new Error('Missing original trade prompt');
  const trade: HeadlessPrompt = { ...original, id: NATIVE_TRADE, act: -2, get radius() { return exchange.active ? 0 : original.radius; } };
  const candidates = prompts.map(prompt => prompt === original ? trade : prompt), picker = createHeadlessPromptPicker(host);
  const input = nativeQuestInputs(host);
  host.events.on('actor.died', ({ actor }) => {
    const body = roster().find(candidate => candidate.actor?.combatActor() === actor);
    if (body === undefined || body.actor === null) return;
    const amount = coinValue(coinTable?.roll({ kind: body.kind }, () => 0) ?? []);
    if (amount > 0 && bounty.claim(body)) burst.spawn(body.actor.position, amount, callbacks.onCoin, callbacks.onDone);
  }, host.scope, { order: DEATH_ORDER.loot });
  host.onStep(NATIVE_TRADE, dt => {
    if (exchange.active && leadPlayer(host).position.distanceTo(original.position) > closeDistance) exchange.close();
    for (const command of input.scripts()) if (command.actorId === NATIVE_TRADE) {
      if (command.value === -2) { if (picker.pick(candidates, leadPlayer(host).position) === trade) exchange.open(); }
      else if (command.value === -1) exchange.close();
      else if (exchange.active) exchange.use(command.value);
    }
    burst.update(dt, leadPlayer(host).position);
  }, {
    snapshot: (): SimValue => {
      const b = burst.snapshot();
      return { version: 1, durable, purse: purse.snapshot(), owned: structuredClone(ownedSaved), paid: { ...paid }, caps: Object.fromEntries(caps),
        burst: { version: b.version, coins: b.coins.map(c => c === null ? null : { ...c, pos: [...c.pos], vel: [...c.vel] }), groups: b.groups, matrix: b.matrix, count: b.count }, modal: exchange.snapshot() };
    },
    restore: value => {
      const saved = v.parse(savedState, value), coins = readCoinBurstState(saved.burst), restoreModal = exchange.prepareRestore(saved.modal);
      durable = saved.durable; ownedSaved = structuredClone(saved.owned); paid = { ...saved.paid }; caps = new Map(Object.entries(saved.caps));
      purse = new Purse(shard, purseSlot); purse.restore(saved.purse);
      owned = new Owned(shard, ownedSlot); bounty = new Bounty(shard, caps, bountySlot);
      burst.restore(coins, () => callbacks); restoreModal();
    },
  });
  host.scope.onDispose(() => { burst.dispose(); economies.delete(host); });
  const result = { purse: () => purse, owned: () => owned, exchange, coins: burst };
  economies.set(host, result); return result;
}
