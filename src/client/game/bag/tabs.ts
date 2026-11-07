import { engineString } from '@wildshard/engine/strings';
import { icon, type IconId } from '@wildshard/engine/ui/icons';
import type { GameMenu, KitEntry, SkinRow } from '@wildshard/engine/ui/Menu';
import type { TabSpec, TabFragment } from '@wildshard/engine/ui/tabs';
import type { Inventory, ItemId } from '../Inventory';
import type { Progress } from '../Progress';
import { completeEntry } from '../complete/ShardComplete';
import { renderGear, renderFinds, type GearTool, type FindsView, type GearLoot } from './bag';

export interface BagMenuOptions {
  tabs?: readonly string[];
  levelName?: string;
  progress: Progress;
  inventory: Inventory;
  kit: () => KitEntry[];
  onEquip?: (id: string) => void;
  skins?: () => SkinRow[];
  onWearSkin?: (id: string) => void;
  skinsTitle?: string;
  pack?: { note: string; hint: string; gearHint?: string; line: (id: ItemId) => string | null };
  /** the bag's glyphs (the kit's, through the session's KitPorts); the engine's generic ones when absent */
  icons?: BagIcons;
  tools?: () => GearTool[];
}
/** the glyphs the bag draws for its tabs and the loot it shows: content's, so the composition root hands them in (E362 AG4) */
export interface BagIcons { gear: IconId; finds: IconId; coin: IconId; charm: IconId; glass: IconId }
const GENERIC_ICONS: BagIcons = { gear: 'pack', finds: 'book', coin: 'star', charm: 'laurel', glass: 'poi' };
export interface BagLoot { gear: () => GearLoot | null; finds: (() => FindsView) | null; wear: (id: string) => void }
const el = (cls: string, html = '', tag = 'div'): HTMLElement => { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; };
const text = (node: HTMLElement, selector: string, value: string): void => {
  const child = node.querySelector(selector); if (child === null) throw new Error(`Missing Bag text slot ${selector}`); child.textContent = value;
};
const words = (cls: string, value: string): HTMLElement => { const node = el(cls); node.textContent = value; return node; };
type BagHost = Pick<GameMenu, 'scope' | 'isOpen' | 'refresh' | 'close' | 'addTab' | 'addTabFragment'>;
const installed = new WeakMap<BagHost, BagMenu>();

/** Game-owned renderers register through the same TabSpecs/fragments as authored content. */
export class BagMenu {
  private get icons(): BagIcons { return this.opts.icons ?? GENERIC_ICONS; }
  private readonly lootRows = new Map<string, BagLoot>();
  private readonly findsRows = new Map<string, () => FindsView>();
  private findsFragments = 0;
  private findsOff: (() => void) | null = null;
  constructor(private menu: BagHost, private opts: BagMenuOptions) {
    if (installed.has(menu)) throw new Error('Bag tabs already installed');
    installed.set(menu, this);
    menu.scope.onDispose(() => { installed.delete(menu); });
    this.register({ id: 'gear', title: engineString('s_d6eaec65e742'), icon: this.icons.gear, order: 10,
      get hint() { return opts.pack?.gearHint ?? engineString('s_d6a37d4c0ef4'); } }, (p) => { this.renderGear(p); });
    if (opts.inventory.slots > 0 && this.allows('pack', 'inventory')) this.register({ id: 'inventory', title: engineString('s_80dc21673e55'), icon: 'pack', order: 30,
      get hint() { return opts.pack?.hint ?? engineString('s_f60c27a1ad27'); } }, (p) => { this.renderInventory(p); });
    if (opts.progress.rows.length > 0 && this.allows('feats', 'achievements')) this.register({ id: 'achievements', title: engineString('s_9194ccf56b9c'), icon: 'star', order: 40,
      hint: engineString('s_b86de6f1d8e0') }, (p) => { this.renderAchievements(p); });
    opts.progress.onChange = () => { if (menu.isOpen) menu.refresh(); };
    opts.inventory.onChange = () => { if (menu.isOpen) menu.refresh(); };
  }
  private allows(...ids: string[]): boolean { return this.opts.tabs === undefined || ids.some((id) => this.opts.tabs?.includes(id) === true); }
  private register(spec: TabSpec, render: (host: HTMLElement) => void): () => void {
    const scope = this.menu.scope.child(`bag.${spec.id}`);
    const offTab = this.menu.addTab(spec);
    const offFragment = this.menu.addTabFragment(spec.id, { id: 'game.content', order: -100, render });
    const off = (): void => { offFragment(); offTab(); };
    scope.onDispose(off); return () => { scope.dispose(); };
  }
  private get loot(): BagLoot | null { return this.lootRows.values().next().value ?? null; }
  private get findsView(): (() => FindsView) | null { return this.loot?.finds ?? this.findsRows.values().next().value ?? null; }
  private syncFinds(): void {
    if (this.menu.scope.disposed || !this.allows('finds')) return;
    if ((this.findsView !== null || this.findsFragments > 0) && this.findsOff === null) {
      const hint = (): string => this.findsView?.().hint ?? engineString('s_77fb830f183c');
      this.findsOff = this.register({ id: 'finds', title: engineString('s_e0c3d922cd87'), icon: this.icons.finds, order: 20,
        get hint() { return hint(); } }, (p) => { this.renderFinds(p); });
    } else if (this.findsView === null && this.findsFragments === 0 && this.findsOff !== null) { this.findsOff(); this.findsOff = null; }
    if (this.menu.isOpen) this.menu.refresh();
  }
  fragment(tab: string, fragment: TabFragment): () => void {
    const finds = tab === 'finds';
    if (finds) { this.findsFragments++; this.syncFinds(); }
    let off: () => void;
    try { off = this.menu.addTabFragment(tab, fragment); }
    catch (error) { if (finds) { this.findsFragments--; this.syncFinds(); } throw error; }
    let active = true;
    let forget: () => void = () => undefined;
    // SF57: an early remove (the shard's own scope leaving) also drops the page menu's hold, or the fragment's render
    // closure (and the shard world it reads) lived as long as the page
    const remove = (): void => {
      if (!active) return;
      active = false; forget(); off();
      if (finds) { this.findsFragments--; this.syncFinds(); }
    };
    forget = this.menu.scope.capture('disposers', remove); return remove;
  }
  addFinds(id: string, finds: () => FindsView): () => void {
    if (this.findsRows.has(id)) throw new Error(`Duplicate Bag finds: ${id}`);
    this.findsRows.set(id, finds); this.syncFinds();
    let live = true;
    let forget: () => void = () => undefined;
    const off = (): void => { if (!live) return; live = false; forget(); this.findsRows.delete(id); this.syncFinds(); };
    forget = this.menu.scope.capture('disposers', off); return off;
  }
  addLoot(id: string, loot: BagLoot): () => void {
    if (this.lootRows.has(id)) throw new Error(`Duplicate Bag loot: ${id}`);
    this.lootRows.set(id, loot); this.syncFinds();
    let live = true;
    let forget: () => void = () => undefined;
    const off = (): void => { if (!live) return; live = false; forget(); this.lootRows.delete(id); this.syncFinds(); };
    forget = this.menu.scope.capture('disposers', off); return off;
  }
  // ── GEAR (E314, board 6 C): the paper doll — every shard's weapons and skins, the shard's loot where it has one ──
  private renderGear(p: HTMLElement): void {
    renderGear(p, {
      weapons: this.opts.kit(), skins: this.opts.skins?.() ?? [], loot: this.loot?.gear() ?? null, ...(this.opts.skinsTitle !== undefined ? { skinsTitle: this.opts.skinsTitle } : {}),
      tools: this.opts.tools?.() ?? [],
      scope: this.menu.scope,
      onEquip: (id) => { this.opts.onEquip?.(id); this.menu.refresh(); },
      onWearSkin: (id) => { this.opts.onWearSkin?.(id); this.menu.refresh(); },
      onWear: (id) => { this.loot?.wear(id); this.menu.refresh(); },
      icons: this.icons,
    });

  }

  // ── FINDS (E314, board 7 B): the sticker book — only on a shard with finds ──
  private renderFinds(p: HTMLElement): void {
    const sources = [...this.findsRows.values()];
    if (this.loot?.finds) sources.unshift(this.loot.finds);
    p.replaceChildren();
    for (const source of sources) {
      const host = sources.length === 1 ? p : document.createElement('div');
      renderFinds(host, source(), this.menu.scope, this.icons);
      if (host !== p) p.append(host);
    }

  }

  // ── PACK (the Inventory): the junk the hunt leaves you, as before; its weapon cards moved to GEAR (E314) ──
  private renderInventory(p: HTMLElement): void {
    p.replaceChildren();
    const items = this.opts.inventory.items;
    const slots = this.opts.inventory.slots;
    const trade = this.opts.pack;
    p.append(el('ws-gmenu-label', engineString('s_94d98347b2ef', [items.length, slots])));
    if (trade) p.append(words('ws-gmenu-packnote', trade.note));
    const grid = el('ws-gmenu-grid');
    for (let i = 0; i < slots; i++) {
      const it = items[i];
      const line = it && trade ? trade.line(it.id) : null; // Pine Hollow: what Mott gives for it (E314 C)
      const slot = it ? el('ws-gmenu-slot', engineString('s_96ae14555109', [icon(it.icon), it.count, '', line !== null ? engineString('s_b5f268a201a9', ['']) : ''])) : el('ws-gmenu-slot empty');
      if (it) text(slot, '.ws-gmenu-sname', it.label);
      if (line !== null) text(slot, '.ws-gmenu-sline', line);
      grid.append(slot);
    }
    p.append(grid);
  }

  // ── ACHIEVEMENTS ──
  private renderAchievements(p: HTMLElement): void {
    const pr = this.opts.progress; p.replaceChildren();
    const rows = pr.rows, n = rows.length, e = pr.earnedCount;
    const levelName = this.opts.levelName ?? '';
    // the shard's "complete" card (E132, src/client/game/complete/ShardComplete.ts), once its quest is done: a row on top that reopens it
    const done = completeEntry();
    if (done) {
      const row = el('ws-gmenu-done', engineString('s_07078891e4d4', [icon('laurel'), '', '']), 'button');
      text(row, '.ws-gmenu-aname', done.label); text(row, '.ws-gmenu-agoal', done.sub);
      (row as HTMLButtonElement).type = 'button';
      this.menu.scope.listen(row, 'click', () => { this.menu.close(true); done.open(); });   // silent: the card resumes play itself
      p.append(row);
    }
    p.append(words('ws-gmenu-label', engineString('s_19898a95936f', [levelName, e, n])));
    p.append(el('ws-bar ws-gmenu-total', engineString('s_3ac582ba7063', [n ? (e / n) * 100 : 0])));
    p.append(el('ws-gmenu-label', engineString('s_e2d6dc448c63')));
    const t = pr.title;
    const titleCard = el(`ws-gmenu-titlecard${t ? '' : ' none'}`, engineString('s_7eb13d096208', [icon('laurel'), '', t ? engineString('s_3b833995b06d') : engineString('s_f912f6149076')]));
    text(titleCard, '.ws-gmenu-titletext', t?.title ?? engineString('s_7aa430f0081b')); p.append(titleCard);
    p.append(el('ws-gmenu-label', engineString('s_da4ea1a751fa')));
    if (!n) p.append(el('ws-gmenu-empty', engineString('s_86170799a9ce')));
    for (const r of rows) {
      const row = el(`ws-gmenu-ach${r.earned ? ' earned' : ''}${r.active ? ' active' : ''}`, engineString('s_7f1998be1049', [r.def.icon, icon(r.def.icon), '', '', r.count, r.def.count, (r.count / r.def.count) * 100, icon(r.earned ? 'check' : 'lock'), '', r.active ? engineString('s_c965a4b3b12e') : '']), 'button');
      text(row, '.ws-gmenu-aname', r.def.name); text(row, '.ws-gmenu-agoal', `${r.def.goal} · ${r.count} / ${r.def.count}`); text(row, '.ws-gmenu-atitle', r.def.title);
      (row as HTMLButtonElement).type = 'button';
      this.menu.scope.listen(row, 'click', () => { if (r.earned) pr.wear(r.def.id); });
      p.append(row);
    }
  }


}

export function bagMenu(menu: BagHost): BagMenu {
  const bag = installed.get(menu);
  if (bag === undefined) throw new Error('Bag tabs are not installed');
  return bag;
}
