import type { Scope } from '../../../shared/engine/app/scope';
import {pagePresentation,type ForegroundView} from '../app/view/presentation';

export type UiLayer = 'hud' | 'gameMenu' | 'menu' | 'modal' | 'error';
export interface UiView {
  root: HTMLElement;
  back: () => void;
  /** Preserve an existing widget's order within its layer. */
  order?: number;
  /** An embedded view inherits its ancestor's input ownership; it only registers placement/lifetime. */
  embedded?: boolean;
  /** the menu actions (pause, map, inventory) close this view and open the game menu instead of being ignored under it (a dialogue box, E385) */
  yieldsToMenu?: boolean;
  /** Presentation only; input ownership, placement and styling are unchanged. */
  presentation?: 'opaque' | 'glass' | 'world';
}
export interface UiHandle { readonly active: boolean; readonly top: boolean; dispose: () => void }
interface Entry { layer: UiLayer; view: UiView; handle: UiHandle; resident: Scope | null; forget: () => void }
const PRIORITY: Record<UiLayer, number> = { hud: 0, gameMenu: 1, menu: 2, modal: 3, error: 4 };

/** A single back/input owner; resident scopes retain their own overlay entries. */
export class UiLayers {
  private readonly now: () => number;
  /** QA row 15: whether this stack is the page's own (AppUi), the one that mirrors an open menu onto <html data-ws-menu> */
  private readonly mirrorMenu: boolean;
  constructor(now: () => number = () => 0, mirrorMenu = false) { this.now = now; this.mirrorMenu = mirrorMenu; }
  closedAt: number = Number.NEGATIVE_INFINITY;
  private entries: Entry[] = [];
  private readonly stills = new Set<Scope>();
  private readonly covers = new Set<Scope>();
  private readonly observers = new Set<() => void>();
  private readonly bindings = new WeakSet<Scope>();
  /** called when the first still hold starts, so the owner can draw the one frame the world is held on */
  onStill: (() => void) | undefined;
  /** A retired world cannot remain reachable through the page's capture port. */
  bindStill(scope: Scope, capture: () => void): void {
    if(scope.disposed||scope.disposing)return;
    this.onStill=capture;
    scope.onDispose(()=>{if(this.onStill===capture)this.onStill=undefined;});
  }
  private changed: (() => void) | undefined;
  private owner: (() => Scope | null) | undefined;
  connect(changed: () => void, owner?: () => Scope | null): void { this.changed = changed; this.owner = owner; }
  private visible(): Entry[] {
    const owner = this.owner?.();
    return this.entries.filter((entry) => entry.resident === null || entry.resident === owner)
      .sort((a, b) => PRIORITY[a.layer] - PRIORITY[b.layer]);
  }
  private input(): Entry[] { return this.visible().filter((entry) => entry.view.embedded !== true); }
  get top(): UiLayer { return this.input().at(-1)?.layer ?? 'hud'; }
  get blocking(): boolean { return this.top !== 'hud'; }
  /** the input owner on top closes for the game menu (`UiView.yieldsToMenu`) */
  get topYields(): boolean { return this.input().at(-1)?.view.yieldsToMenu === true; }
  /** FC3 (G909): a glass screen over the world (the journal, a shop, a quest board) holds the world on one still frame
   *  while `scope` lives: no simulation and no world frames, like the pause menu, without showing the pause menu */
  holdStill(scope: Scope): void {
    if (scope.disposed || this.stills.has(scope)) return;
    const first = this.stills.size === 0;
    this.stills.add(scope);
    scope.onDispose(() => { this.stills.delete(scope); this.refresh(); }); // the stack's owner hears the release (a parked loop wakes)
    if (first) this.onStill?.();
    this.refresh();
  }
  get still(): boolean { return this.stills.size > 0; }
  /** Loading widgets cover the world without becoming a new input/DOM layer. */
  holdCovered(scope: Scope): void {
    if (scope.disposed || scope.disposing || this.covers.has(scope)) return;
    this.covers.add(scope);scope.onDispose(() => {this.covers.delete(scope);this.refresh();});this.refresh();
  }
  get presentation(): ForegroundView {
    if (this.covers.size > 0) return 'covered';
    const front=this.input().at(-1);
    const kind=front?.view.presentation ?? (front?.layer === 'hud' || front === undefined ? 'world' : 'opaque');
    if(kind==='opaque')return 'covered';
    return kind==='glass'||this.still?'still':'play';
  }
  /** Explicit page composition binding: constructing a layer stack installs nothing. */
  bindPresentation(scope: Scope, wake?: () => void): void {
    if(scope.disposed||scope.disposing||this.bindings.has(scope))return;
    this.bindings.add(scope);
    const update=():void=>{pagePresentation.setCoverage(this.presentation);pagePresentation.refresh();wake?.();};
    this.observers.add(update);scope.onDispose(()=>{this.observers.delete(update);});update();
  }
  isTop(handle: UiHandle): boolean { return this.input().at(-1)?.handle === handle; }
  push(layer: UiLayer, view: UiView, scope: Scope): UiHandle {
    let active = !scope.disposed;
    const isTop = (): boolean => this.input().at(-1)?.view === view;
    const handle: UiHandle = {
      get active() { return active; },
      get top() { return active && isTop(); },
      dispose: () => {
        if (!active) return;
        active = false;
        if (view.embedded !== true) this.closedAt = this.now();
        const at = this.entries.findIndex((entry) => entry.handle === handle);
        if (at !== -1) { const [entry] = this.entries.splice(at, 1); entry?.forget(); }
        this.refresh();
      },
    };
    if (!active) return handle;
    const owner = this.owner?.();
    const entry: Entry = { layer, view, handle, resident: owner && scope.belongsTo(owner) ? owner : null,
      forget: () => { /* Assigned below. */ } };
    view.root.style.zIndex = `calc(var(--ws-layer-${layer}) + ${view.order ?? 0})`;
    this.entries.push(entry);
    entry.forget = scope.capture('disposers', handle.dispose);
    this.refresh();
    return handle;
  }
  back(): boolean {
    const entry = this.input().at(-1);
    if (entry === undefined) return false;
    entry.view.back();
    return true;
  }
  /** A menu or panel covers the world (the bag, the map, pause, settings, a shop, the journal): any input owner above the HUD
   *  that is not drawn as part of the world (an NPC's dialogue box is). */
  get menuOpen(): boolean { return this.input().some((entry) => entry.layer !== 'hud' && entry.view.presentation !== 'world'); }
  refresh(): void {
    const visible = this.input(), top = visible.at(-1);
    for (const entry of visible) entry.view.root.inert = entry !== top;
    // QA row 15 (Jake, 2026-11-10: "When the menu is open, can we just hide the chat and the audio?"): <html data-ws-menu> while
    // one is, so a page module outside this bundle (the online chat row and its mic, src/client/host/online/chatLines.ts) can
    // stand aside in CSS; nothing it runs stops
    // (a node bake's stub document has no documentElement, app.ts)
    const root = !this.mirrorMenu || typeof document === 'undefined' ? null : (document.documentElement as HTMLElement | null | undefined) ?? null;
    if (root !== null) { if (this.menuOpen) root.dataset['wsMenu'] = 'open'; else delete root.dataset['wsMenu']; }
    this.changed?.();
    for(const update of this.observers)update();
  }
}
