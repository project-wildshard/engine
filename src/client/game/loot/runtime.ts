import * as v from 'valibot';
import { LootBagSchema } from '@wildshard/format/lootBag';
import { bagMenu } from '../bag/tabs';
import * as THREE from 'three';
import { ItemPickup } from '@wildshard/engine/player/WeaponPickup';
import type { GameMenu } from '@wildshard/engine/ui/Menu';
import type { MapMark } from '@wildshard/engine/ui/Minimap';
import type { GearLoot, FindsView } from '../bag/bag';
import { CoinChip } from './ui/CoinChip';
import { CoinBurst } from './CoinBurst';
import { Purse, publishPurse } from '../../../shared/game/loot/Purse';
import { coinsOn, type LootGate } from './coins';
import type { LootFeed } from './feed';
import { readOnlySave, wirePage } from '../shardfile/wirePage';
import { purseSave } from '../../../shared/game/saves';
import { OWNED,isCosmetic, isOwnedId, type Owned, type OwnedId } from '../../../shared/game/loot/Owned';
import { declaredLootPresentation } from '../../../shared/game/shard/declaredRows';
import { createFindsCatalogue } from '../../../shared/game/bag/findsCatalogue';
import { boundQuestState } from '../../../shared/game/quest/boundState';
import { InteractSfx } from '@wildshard/engine/audio/interactSfx';
import type { CreatureDeathSource } from '../../../shared/game/loot/deaths';
import type { ShardContext } from "../plugin/context";
import { installEnteredRuntimeService } from '../shard/retainedHooks';
import { DynamicBodySlots } from '@wildshard/engine/physics/bodies';

export interface LootShop { readonly isOpen: boolean; render: () => void; dispose: () => void }
export interface LootPresentation {
  debugName?: string;
  /** The shard supplies its registered goods, prompt and presentation; the mechanism owns the purse and lifetime. */
  shop?: (purse: Purse) => LootShop | null;
  gear: (purse: Purse) => GearLoot;
  finds: (() => FindsView) | null;
  marks: (() => readonly MapMark[]) | null;
  charted: () => boolean;
  lateKinds?: readonly string[];
  chime: () => void;
}
export interface LootBody extends CreatureDeathSource { kind: string; position: THREE.Vector3; herd: number; alive: boolean }
export interface ScopedLootHost<A extends LootBody> {
  ctx: ShardContext;
  owned: Owned;
  manifest: LootGate & { slug: string };
  scene: THREE.Scene;
  player: { position: THREE.Vector3 };
  camera: THREE.Camera;
  animals: () => readonly A[];
  before?: readonly string[];
  menu: GameMenu;
  presentation: LootPresentation;
  minimap?: { setMarks: (source: (() => readonly MapMark[]) | null) => void } | null;
  /** What pays this player: the page's own deaths and bounty, until a server owns them. */
  feed?: LootFeed;
}
export interface ScopedLoot { purse: Purse | null; dispose: () => void }

/**
 * Any coin-enabled manifest gets the same scoped coin and shop mechanism. The purse, bounty, burst and shop live with the
 * runtime; what is page-global (the coin chip on the HUD, the Bag's loot row, the minimap's marks) is an entered service,
 * on while this runtime is entered and off when it leaves, so two runtimes live on one page never collide.
 */
export function installLoot<A extends LootBody>(h: ScopedLootHost<A>): ScopedLoot {
  if (!coinsOn(h.manifest)) return { purse: null, dispose: () => undefined };
  const { ctx, owned, presentation: view } = h;
  const lifetime = ctx.scope.child('loot');
  // J130: on the wire the server owns the coins, and a page's purse only shows its rows
  const purse = new Purse(h.manifest.slug, readOnlySave(purseSave)), burst = new CoinBurst(h.scene);
  wirePage.hold({ purse }, lifetime);
  let chip: CoinChip | null = null, entered = false, leave: (() => void) | null = null;
  const releasePurse = publishPurse(ctx.scope, purse);
  let live = true, charted = false;
  ctx.system({ id: 'game.loot', phase: 'update', before: h.before ?? [], run: (dt) => { if (live) burst.update(dt, h.player.position); } });
  const flush = (): void => { purse.flush(); };
  const onHidden = (): void => { if (document.visibilityState === 'hidden') flush(); };
  lifetime.listen(window, 'pagehide', flush); lifetime.listen(document, 'visibilitychange', onHidden);
  // the page's law stays until the flip deletes it; a page with a wire has one payer, the server (J105)
  const feed = h.feed ?? (wirePage.lootFeed(lifetime));
  const projected = new THREE.Vector3(), fell = new THREE.Vector3();
  const offPayouts = feed.onPayout(({ at, coins: n }) => {
    if (!live) return;
    burst.spawn(fell.set(at.x, at.y, at.z), n, () => undefined, () => { flush(); view.chime(); });
    projected.set(at.x, at.y + 1.5, at.z).project(h.camera);
    if (chip !== null && projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1) chip.pop((projected.x + 1) * 0.5 * window.innerWidth, (1 - projected.y) * 0.5 * window.innerHeight, n);
  });
  lifetime.onDispose(offPayouts);
  const applyChart = (): void => {
    const want = entered && view.charted() && view.marks !== null;
    if (want !== charted) { charted = want; h.minimap?.setMarks(want ? view.marks : null); }
  };
  const shop = view.shop?.(purse) ?? null;
  installEnteredRuntimeService(ctx, (scope) => {
    if (!live) return;
    const shown = new CoinChip(purse.coins), offBag = bagMenu(h.menu).addLoot('loot', { gear: () => view.gear(purse), finds: view.finds,
      wear: (id) => { if (!isOwnedId(id) || !isCosmetic(id)) return; wirePage.wear(id); } });
    chip = shown; entered = true; applyChart();
    const off = (): void => {
      if (chip !== shown) return;
      entered = false; applyChart(); offBag(); shown.dispose(); chip = null; leave = null;
    };
    leave = off; scope.onDispose(off);
  });
  const refresh = (): void => { if (h.menu.isOpen) h.menu.refresh(); };
  const offOwned = owned.onChange(() => { applyChart(); refresh(); });
  const offPurse = purse.onChange((n) => { chip?.set(n); if (shop?.isOpen === true) shop.render(); refresh(); });
  ctx.debug.expose(view.debugName ?? `${h.manifest.slug}.loot`, { purse, owned, ...feed.debug, grant: (id: OwnedId) => owned.grant(id), coins: (n: number) => { purse.add(n); }, shop });
  const dispose = (): void => {
    if (!live) return;
    live = false; flush(); offOwned(); offPurse(); releasePurse();
    lifetime.dispose();
    leave?.();
    shop?.dispose(); burst.dispose();
  };
  ctx.scope.onDispose(dispose);
  return { purse, dispose };
}

/** Existing coin-enabled pages share this admitted row/identity entry point.
 * Rich Bag rows are explicit; no display path discovers a full economy. */
export function enteredLootPresentation(ctx:ShardContext,id:string,bag?:unknown):LootPresentation{
  if(ctx.scope.disposed||ctx.scope.disposing)throw new Error('Loot projection requires its live entered owner');
  const admitted=bag===undefined?undefined:v.parse(LootBagSchema,bag);
  const row=ctx.product.section('economy/loot').rows.loot.find(entry=>entry.id===id),play=ctx.game.runtime?.play;
  if(row===undefined||!('gear'in row)||play===null||play===undefined)throw new Error('Loot projection requires its entered owner');
  const basic=declaredLootPresentation(row,token=>{if(!token.startsWith('cue.'))throw new Error('Unknown registered loot cue');play.cues.cue(`cue.${token.slice(4)}`);});
  if(admitted===undefined)return basic;
  const economy=admitted,view=economy.presentation,health=ctx.app.player;
  if(health===null)throw new Error('Loot Bag needs its admitted view and native health');
  const flags=boundQuestState(ctx.scope,view.quest).flags,owned=play.owned,audio=play.audio;
  const ownedId=(key:string):void=>{if(!isOwnedId(key))throw new Error('Unknown Bag ownership');};
  ownedId(view.chart);ownedId(economy.progression.glow.owned);
  for(const state of economy.progression.states)for(const earned of state.earned)ownedId(earned.id);
  for(const section of economy.finds.sections)for(const item of section.items)if('owned'in item)ownedId(item.owned);
  const cosmetics=view.cosmetics.map(entry=>{const cosmeticId=entry.id;if(!isOwnedId(cosmeticId)||!isCosmetic(cosmeticId))throw new Error('Loot cosmetic must name its native ownership');return {id:cosmeticId,icon:entry.icon,how:entry.how};});
  const finds=createFindsCatalogue(economy.finds),sfx=new InteractSfx(audio);
  return {debugName:row.id,lateKinds:view.lateKinds,
    charted:()=>owned.has(view.chart),marks:()=>economy.marks.filter(mark=>!flags.has(mark.flag)).map(({x,z,color})=>({x,z,color})),
    chime:()=>{sfx.interact(view.chime.sound,undefined,{gain:view.chime.gain});},finds:()=>finds({flags,owned}),
    gear:purse=>({sharpen:owned.sharpen,health:{max:health.attributes.maxHealth,hearts:owned.hearts},
      charms:{owned:owned.charms,next:economy.progression.states[economy.progression.flags.filter(flag=>flags.has(flag)).length]?.next??null},
      cosmetics:cosmetics.map(entry=>({id:entry.id,icon:entry.icon,how:entry.how,name:OWNED[entry.id].label,owned:owned.has(entry.id),worn:owned.worn(entry.id)})),coins:purse.coins}),
  };
}

/** Install ordinary loot against the admitted world services without exposing a raw scene to runtime content. */
export function installRuntimeLoot(ctx: ShardContext, presentation: LootPresentation, options: { readonly minimap?: boolean; readonly before?: readonly string[] } = {}): ScopedLoot | null {
  const runtime = ctx.game.runtime;
  if (runtime?.play === null || runtime?.play === undefined || runtime.world === null) return null;
  return installLoot({ ctx, manifest: ctx.manifest, owned: runtime.play.owned, scene: runtime.world.game.scene,
    player: runtime.world.player, camera: runtime.world.game.camera, animals: () => runtime.play?.animals.animals ?? [],
    menu: runtime.play.menu, presentation,
    ...(options.minimap === true ? { minimap: runtime.play.minimap ?? null } : {}),
    ...(options.before === undefined ? {} : { before: options.before }) });
}

/** Bounded authored presentation and retirement of an already claimed loot identity. */
export interface ClaimedPickupRow {
  readonly death?: { readonly kind: string; readonly variant?: string; readonly floor: 'source' | 'ground' | 'max';
    readonly towardPlayer?: { readonly distance: number; readonly epsilon: number } };
  readonly options: Pick<ConstructorParameters<typeof ItemPickup>[0], 'scale' | 'tilt' | 'glow' | 'prompt'> & { readonly tier?: string };
  readonly toss: { readonly horizontal: number; readonly up: number };
  readonly walkIn: { readonly radius: number; readonly height: number } | null;
  readonly takenGrace: number;
  readonly unique: boolean;
  readonly disposeItemOnTake: boolean;
  readonly retireBeforeCallback: boolean;
}
/** Content retains its model, grant/wear callbacks and independent cosmetic/loot RNG streams. */
export interface ClaimedPickupPorts<I extends string> {
  readonly scene: THREE.Scene;
  readonly has: (id: I) => boolean;
  readonly model: (id: I) => THREE.Object3D;
  readonly take: (id: I, item: THREE.Object3D) => void;
  readonly random: () => number;
  readonly visualRandom?: () => number;
  readonly enter?: (id: I, drop: ItemPickup) => void;
}
/** One owner for floating claimed items and their original after-take grace policy; never advances physics itself. */
export class ClaimedPickupRoster<I extends string> {
  readonly drops: Map<I, ItemPickup> = new Map<I, ItemPickup>();
  private readonly active = new Map<ItemPickup, { id: I; row: ClaimedPickupRow }>();
  private readonly fading: { drop: ItemPickup; left: number }[] = [];
  constructor(private readonly rows: Readonly<Record<string, ClaimedPickupRow | undefined>>, private readonly ports: ClaimedPickupPorts<I>) {
    const keys = Object.keys(rows);
    if (keys.length === 0 || keys.length > 128) throw new Error('Claimed pickup rows exceed their bound');
    for (const id in rows) {
      if (!Object.hasOwn(rows, id)) continue;
      const row = rows[id];
      if (row === undefined || !Number.isFinite(row.takenGrace) || row.takenGrace < 0 || row.takenGrace > 60
        || !Number.isFinite(row.toss.horizontal) || !Number.isFinite(row.toss.up)
        || (row.walkIn !== null && (!(row.walkIn.radius > 0) || !(row.walkIn.height > 0)))) throw new Error('Invalid claimed pickup row');
    }
  }
  /** Resolve a death without sampling terrain or claiming ownership. The caller keeps its current floor query and event order. */
  death(actor: { readonly kind: string; readonly variant?: string | undefined; readonly position: THREE.Vector3 }, player: THREE.Vector3,
    candidates: readonly string[] = Object.keys(this.rows)): { id: I; at: THREE.Vector3; floor: 'source' | 'ground' | 'max' } | null {
    if (candidates.length > 128) throw new Error('Claimed death candidates exceed their bound');
    for (const candidate of candidates) {
      if (!Object.hasOwn(this.rows, candidate)) continue;
      const id = candidate as I, policy = this.rows[id]?.death;
      if (policy === undefined || policy.kind !== actor.kind || policy.variant !== undefined && policy.variant !== actor.variant) continue;
      if (this.ports.has(id)) return null;
      const at = actor.position.clone(), toward = policy.towardPlayer;
      if (toward !== undefined) {
        const distance = Math.hypot(at.x - player.x, at.z - player.z), ratio = distance > toward.epsilon ? Math.min(1, toward.distance / distance) : 0;
        at.x = player.x + (at.x - player.x) * ratio; at.z = player.z + (at.z - player.z) * ratio;
      }
      return { id, at, floor: policy.floor };
    }
    return null;
  }
  spawn(id: I, at: THREE.Vector3, toss: boolean): ItemPickup | null {
    const row = this.rows[id];
    if (row === undefined) throw new Error('Unknown claimed pickup row');
    if (this.ports.has(id) || (row.unique && this.drops.has(id))) return null;
    if (this.active.size + this.fading.length >= 128) throw new Error('Claimed pickup roster is full');
    const { tier, ...options } = row.options;
    if (tier !== undefined && tier !== 'common' && tier !== 'rare' && tier !== 'legendary') throw new Error('Invalid claimed pickup tier');
    const item = this.ports.model(id), angle = this.ports.random() * Math.PI * 2, velocity = { x: 0, y: 0, z: 0 };
    if (toss) DynamicBodySlots.velocity({ kind: 'radial', ...row.toss }, at, at, angle, velocity);
    const drop = new ItemPickup({ ...options, ...(tier === undefined ? {} : { tier }), scene: this.ports.scene, item, position: at.clone(),
      ...(toss ? { toss: velocity } : {}),
      ...(this.ports.visualRandom === undefined ? {} : { random: this.ports.visualRandom }) });
    this.ports.enter?.(id, drop);
    const retire = (): void => {
      this.active.delete(drop); if (this.drops.get(id) === drop) this.drops.delete(id);
      if (row.takenGrace > 0) this.fading.push({ drop, left: row.takenGrace });
      if (row.disposeItemOnTake) item.traverse(o => { if (o instanceof THREE.Mesh) { const geometry: unknown = o.geometry; if (geometry instanceof THREE.BufferGeometry) geometry.dispose(); } });
    };
    drop.onPickup = () => { if (row.retireBeforeCallback) retire(); this.ports.take(id, item); if (!row.retireBeforeCallback) retire(); };
    this.active.set(drop, { id, row }); this.drops.set(id, drop);
    return drop;
  }
  update(dt: number, t: number, renderer: Parameters<ItemPickup['update']>[2], camera: Parameters<ItemPickup['update']>[3], player: THREE.Vector3): void {
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const entry = this.fading[i]; if (entry === undefined) continue;
      entry.drop.update(dt, t, renderer, camera); if ((entry.left -= dt) <= 0) this.fading.splice(i, 1);
    }
    for (const [drop, { row }] of this.active) {
      drop.update(dt, t, renderer, camera);
      const reach = row.walkIn, at = drop.group.position;
      if (reach !== null && Math.hypot(at.x - player.x, at.z - player.z) < reach.radius && Math.abs(at.y - player.y) < reach.height) drop.take();
    }
  }
}
