import { wirePage } from '../shardfile/wirePage';
import type { ShardContext } from '../plugin/context';
import { FigureRows } from '../systems/npc/figureRows';
import { QuestTraderSchema } from '@wildshard/format/namedJsonContracts';
import * as v from 'valibot';
import { Vector3, type Object3D } from 'three';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { WorldRegistry } from '@wildshard/engine/world/registry';
import { InteractSfx } from '@wildshard/engine/audio/interactSfx';
import { isJsonData } from '@wildshard/format/json';
import { declaredLootEconomy } from '../../../shared/game/shard/declaredRows';
import { enteredPurse } from '../../../shared/game/loot/Purse';
import { Exchange } from '../../../shared/game/loot/exchange';
import { ShopPanel, type ShopGood } from '../loot/ui/ShopPanel';
import { enteredHeldLoadout } from '../loadout/held';
import { DeclaredAmbience } from '@wildshard/engine/audio/declaredAmbience';
import { HeldFinishes } from '../loadout/finishes';
import { QuestViews, bindQuestPageInteractions } from '../plugin/ui';
import type { QuestPageInteractionsData } from '@wildshard/format/questInteractions';
import type { Scope } from '@wildshard/engine/app/scope';

const enteredTraders = new WeakMap<Scope, Map<string, QuestTrader>>();
const installedShops = new WeakSet<QuestTrader>();
type QuestShopGood = ShopGood & { readonly needs?: string };

/** Open the registered counter by data identity from a prompt or a completed talk. */
export function openQuestTrader(scope: Scope, name: string): void {
  if (scope.disposed) return;
  const trader = enteredTraders.get(scope)?.get(name);
  if (trader === undefined) throw new Error(`Missing entered trader ${name}`);
  trader.open();
}

/** Immutable trader placement and view policy; stock and payments stay with the existing shop. */
export type QuestTraderRows = v.InferOutput<typeof QuestTraderSchema>;
/** Validate admitted rows before placing a model or changing a camera. */
export function parseQuestTrader(input: unknown): QuestTraderRows { return v.parse(QuestTraderSchema, input); }
/** The actual shop owner; the binding never creates a second inventory or save. */
export interface TraderShop { open: () => void; close: () => void; readonly isOpen: boolean }
/** Existing NPC motion and culling owners lent by the model registry. */
export interface TraderFigure {
  readonly position: Vector3; readonly companions: Object3D[]; offer: () => void;
}
/** Presentation handles borrow the existing shop and entered figure. */
export interface QuestTrader {
  readonly name: string; readonly trader: TraderFigure | null; readonly at: Vector3;
  shop: TraderShop | null; readonly open: () => void;
}
/** Native page services only; authored placement and view policy arrive as rows. */
export interface QuestTraderContext extends Pick<ShardContext, 'scope' | 'system'> {
  readonly game: { readonly runtime?: {
    readonly world: { readonly registry: Pick<WorldRegistry, 'get'>; readonly player: { readonly position: Vector3; yaw: number; pitch: number } } | null;
    readonly play: object | null;
    readonly interactables: Interactable[];
  } };
}
/** A placed shop names already-entered resources; a talk-opened shop omits them. */
export interface QuestTraderResources {
  readonly figure: string; readonly counter: string; readonly offer: string;
  readonly at: { readonly x: number; readonly y: number; readonly z: number };
  readonly prompt: { readonly label: string; readonly radius: number };
  readonly before: readonly string[];
  /** The shop's admitted page rows (G1c): its placed prompt binds through the shared page binder over the owners `shop`
   *  (`at`, `ready`, `open`) and `commands` (`trade`); absent, the prompt is built from `prompt` as before. */
  readonly page?: QuestPageInteractionsData;
}
/** Client-only trader binding shared by talk-opened and placed shops. Models,
 * panels, inventory and saves stay with their original entered owners. */
export function installQuestTrader(ctx: QuestTraderContext, input: unknown, resources?: QuestTraderResources): QuestTrader {
  const row = parseQuestTrader(input), world = ctx.game.runtime?.world, play = ctx.game.runtime?.play;
  if (world === undefined || world === null || play === undefined || play === null || ctx.scope.disposed) throw new Error('Trader requires its entered world');
  if ((row.placement === undefined) !== (resources === undefined) || (row.view !== undefined && resources === undefined)) throw new Error('Trader resources do not match its declaration');
  if (resources !== undefined && (!Number.isFinite(resources.prompt.radius) || resources.prompt.radius < 0 || resources.prompt.radius > 100)) throw new Error('Invalid trader prompt radius');
  const traders = enteredTraders.get(ctx.scope) ?? new Map<string, QuestTrader>();
  if (traders.has(row.name) || traders.size >= 64) throw new Error('Duplicate or full entered trader roster');
  const figure = resources === undefined ? null : FigureRows.entered(ctx.scope, resources.figure);
  if (resources !== undefined && world.registry.get(resources.counter) === undefined) throw new Error('Missing trader counter piece');
  const player = world.player, at = resources === undefined ? new Vector3() : new Vector3(resources.at.x, resources.at.y, resources.at.z);
  let pitchBefore = 0, wasOpen = false;
  const stall: QuestTrader = { name: row.name, trader: figure === null || resources === undefined ? null : {
    position: figure.group.position, companions: [], offer: () => { figure.signal(resources.offer); } }, at, shop: null,
    open: () => {
      if (ctx.scope.disposed) return;
      const shop = stall.shop;
      if (shop === null || (!row.reopen && shop.isOpen)) return;
      if (row.view !== undefined) {
        const her = stall.trader?.position;
        if (her === undefined) throw new Error('Trader view requires its entered figure');
        const p = player.position;
        player.yaw = Math.atan2(-(her.x - p.x), -(her.z - p.z)); pitchBefore = player.pitch; player.pitch = row.view.pitch;
      }
      shop.open(); stall.trader?.offer(); wasOpen = true;
    } };
  if (resources !== undefined && row.placement !== undefined) {
    const prompts = ctx.game.runtime?.interactables;
    if (prompts === undefined) throw new Error('Missing trader prompt owner');
    const page = resources.page;
    const prompt: Interactable = page === undefined ? { position: at, label: resources.prompt.label,
      get radius() { return stall.shop !== null && !stall.shop.isOpen ? resources.prompt.radius : 0; }, onInteract: () => { openQuestTrader(ctx.scope, row.name); } }
      : bindQuestPageInteractions(page, { flags: { has: () => false, set: () => { throw new Error('Trader page owns no flags'); } },
        toast: () => { throw new Error('Trader page shows no toasts'); }, promptIds: ['trade'],
        owners: new Map<string, unknown>([['shop', { at, get ready() { return stall.shop !== null; }, get open() { return stall.shop?.isOpen === true; } }],
          ['commands', { trade: () => { openQuestTrader(ctx.scope, row.name); } }]]) }).prompt('trade');
    prompts.push(prompt); ctx.scope.onDispose(() => { const i = prompts.indexOf(prompt); if (i !== -1) prompts.splice(i, 1); });
    ctx.system({ id: row.placement.system, phase: 'update', before: [...resources.before], run: () => {
      if (ctx.scope.disposed || row.view === undefined) return;
      if (stall.shop?.isOpen === true && player.position.distanceTo(at) > row.view.closeDistance) stall.shop.close();
      if (wasOpen && stall.shop?.isOpen !== true) { wasOpen = false; player.pitch = pitchBefore; }
    } });
  }
  traders.set(row.name, stall); enteredTraders.set(ctx.scope, traders);
  ctx.scope.onDispose(() => { traders.delete(row.name); });
  return stall;
}

/** Client-only coin and barter shop over the entered trader, real inventory,
 * purse, loadout and finish owners. Author input contains no callbacks or paths. */
export function installQuestShop(ctx: ShardContext, input: unknown): () => ShopPanel<QuestShopGood> {
  if (!isJsonData(input)) throw new Error('Quest shop requires JSON rows');
  const row = parseQuestTrader(input), policy = row.shop, stall = enteredTraders.get(ctx.scope)?.get(row.name);
  const runtime = ctx.game.runtime, world = runtime?.world, play = runtime?.play;
  if (runtime === undefined || policy === undefined || stall === undefined || world === undefined || world === null || play === undefined || play === null || ctx.scope.disposed) throw new Error('Quest shop requires its entered trader and play owners');
  if (installedShops.has(stall)) throw new Error('Quest shop already installed');
  const economy = policy.barter ? declaredLootEconomy(ctx.product.section('economy/loot').rows.loot, 'barter') : declaredLootEconomy(ctx.product.section('economy/loot').rows.loot);
  const goods: readonly QuestShopGood[] = economy.goods;
  if (goods.length !== Object.keys(policy.after).length || goods.some(good => policy.after[good.id] === undefined)) throw new Error('Quest shop requires exact purchase feedback');
  const loadout = policy.ammunition === undefined ? null : enteredHeldLoadout(ctx.scope, policy.ammunition.loadout);
  const purse = (): ReturnType<typeof enteredPurse> => enteredPurse(ctx.scope);
  const exchange = new Exchange(economy.exchange, new Map<string, unknown>([
    ['owned', play.owned], ['purse', { count: () => purse().coins, spend: (n: number) => purse().spend(n) }], ['pack', play.inventory],
    ['skins', { owns: (id: string) => HeldFinishes.current(ctx.manifest.slug).has(id) && play.skins.has(id), own: (id: string) => { play.skins.own(id); } }],
    ['ammo', { capacity: (id: string, n: number) => loadout?.room(id, n) ?? false,
      addBolts: (n: number) => { if (loadout === null || policy.ammunition === undefined) throw new Error('Missing shop ammunition'); loadout.addAmmo(policy.ammunition.bolts, n); },
      grant: (id: string, n: number) => { if (loadout === null) throw new Error('Missing shop ammunition'); loadout.addAmmo(id, n); } }],
  ]));
  const sfx = new InteractSfx(play.audio), views = new QuestViews(ctx);
  const feedback = new Map(goods.map(good => [good.id, (policy.after[good.id] ?? []).map(effect => {
    if (effect.kind === 'wear') {
      const finish = HeldFinishes.current(ctx.manifest.slug).get(effect.finish);
      return () => { play.wearSkin(finish); };
    }
    if (effect.kind === 'bark') {
      const at = FigureRows.entered(ctx.scope, effect.figure).talkPoint.clone();
      const audio = runtime.objects[effect.audio];
      if (!(audio instanceof DeclaredAmbience)) throw new Error('Missing shop audio owner');
      const bank = audio.sfx; return () => { bank.bark(effect.group, at); };
    }
    if (effect.kind === 'chime') return () => { sfx.interact('chime', effect.at === 'counter' ? stall.at : undefined, { gain: effect.gain }); };
    if (effect.kind === 'offer') return () => { stall.trader?.offer(); };
    return () => { play.hud.toast(effect.text); };
  })]));
  installedShops.add(stall);
  const create = (scope: Scope): ShopPanel<QuestShopGood> => {
    const index = (good: QuestShopGood): number => goods.findIndex(value => value.id === good.id);
    const panel = new ShopPanel<QuestShopGood>({ trader: row.name, place: policy.place, goods,
      state: good => exchange.state(index(good)), scope,
      ...(policy.barter ? { verb: 'Trade', cost: (good: QuestShopGood) => exchange.cost(index(good)) }
        : { coins: () => purse().coins, needs: (good: QuestShopGood) => good.needs === undefined ? '' : goods.find(value => value.id === good.needs)?.name ?? good.needs }) });
    panel.onBuy = good => {
      const selected = index(good);
      if (!panel.isOpen || selected < 0) return false;
      const bought = exchange.check(selected).ok; if (bought) wirePage.buy(selected, () => { if (!ctx.scope.disposed) for (const effect of feedback.get(good.id) ?? []) effect(); });
      if (!bought) return false;
      return true;
    };
    stall.shop = panel; panel.scope.onDispose(() => { if (stall.shop === panel) stall.shop = null; }); return panel;
  };
  const resident = policy.lifetime === 'resident' ? create(ctx.scope.child('trade')) : null;
  const shop = resident === null ? views.view('trade', create) : () => resident;
  if (policy.modal !== undefined) {
    const modal = policy.modal;
    views.panelHold({ hud: play.hud, weapons: play.weapons, menu: play.menu, nolock: play.nolock, touchUi: play.touchUi, panels: [shop], restartOnClose: modal.restartOnClose,
      stow: on => { if (modal.stow) play.weapons.stowed = on; }, resume: () => { play.weapons.setEnabled(!modal.resumeSwimming || !world.player.swimming); } });
  }
  return shop;
}
