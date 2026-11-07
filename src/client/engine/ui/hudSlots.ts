import { nodeOwner, type Scope } from '../../../shared/engine/app/scope';


export type DiscSpot = 'r0' | 'r1' | 'r2' | 'r3' | 'aim' | 'up0' | 'lean-l' | 'lean-r' | 'edge-r' | 'edge-l' | 'lock' | 'jump';
export interface TouchRelabel { label: string; icon?: string; tone?: 'rest' | 'ready' | 'active'; accent?: string }
export interface DiscOpts {
  /** the disc's own class(es), styled by the owner's stylesheet (`ws-ride-gallop`, `ws-stealth-crouch`) */
  cls: string;
  /** inline svg markup */
  icon: string;
  label: string;
  spot: DiscSpot;
  /** pointer down (the disc lights `.down` while held) */
  press?: () => void;
  /** pointer up / cancel / leave */
  release?: () => void;
}
/** the status column's order: the base's rows first, then whatever a shard adds, then the pills */
export const ROW = { vitals: 0, ammo: 1, content: 2, pill: 10 } as const;

export type HudBand = 'band.1' | 'band.2' | 'band.3' | 'band.4' | 'band.5' | 'band.6';
const DEFAULT_BANDS: readonly HudBand[] = ['band.1', 'band.2', 'band.3', 'band.4', 'band.5', 'band.6'];
export class HudSlots {
  private readonly owners = new WeakMap<Element, Scope>();
  ownerOf(el: Element): Scope | null {
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      const owner = nodeOwner(node) ?? this.owners.get(node);
      if (owner !== undefined) return owner;
    }
    return null;
  }
  private bands = DEFAULT_BANDS;
  private placements = new Map<HTMLElement, { band: HudBand; order: number }>();
  configure(bands: readonly HudBand[] = DEFAULT_BANDS): void {
    if (new Set(bands).size !== bands.length) throw new Error('Duplicate HUD band');
    this.bands = [...bands, ...DEFAULT_BANDS.filter((band) => !bands.includes(band))];
    for (const [el, placement] of this.placements) el.style.order = String(this.rowOrder(placement.band, placement.order));
  }
  private layer: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private readonly cancels = new WeakMap<HTMLElement, () => void>();
  /** SF57: what each element registered on its owner (listeners, the removal); `discard` releases them, so an owner that
   *  outlives the element (a page-scoped HUD adapter serving a resident shard) keeps none of its closures */
  private readonly holds = new WeakMap<HTMLElement, (() => void)[]>();
  private hold(el: HTMLElement, ...releases: (() => void)[]): void { this.holds.set(el, [...(this.holds.get(el) ?? []), ...releases]); }
  private pending: ((layer: HTMLElement, status: HTMLElement) => void)[] = [];

  private rowOrder(band: HudBand, order: number): number { return order + 1000 * (this.bands.indexOf(band) - DEFAULT_BANDS.indexOf(band)); }

  /** Numbered bands have no wrapper: existing HUD geometry and selectors stay identical. */
  widget(band: HudBand, el: HTMLElement, order: number, scope: Scope, root?: HTMLElement): void {
    if (scope.disposed) return;
    this.owners.set(el, scope);
    if (band === 'band.2' || band === 'band.3' || band === 'band.4' || band === 'band.5') {
      this.placements.set(el, { band, order });
      this.statusRow(el, this.rowOrder(band, order), band !== 'band.2');
    } else (root ?? document.getElementById('hud') ?? document.body).append(el);
    this.hold(el, scope.capture('nodes', () => { this.discard(el); }));
  }

  /** TouchControls, once its layer is in #hud */
  mount(layer: HTMLElement, status: HTMLElement): void {
    this.layer = layer; this.status = status;
    for (const f of this.pending.splice(0)) f(layer, status);
  }

  get touch(): boolean { return this.layer !== null; }

  private run(f: (layer: HTMLElement, status: HTMLElement) => void): () => void {
    let live = true;
    const queued = (layer: HTMLElement, status: HTMLElement): void => { if (live) f(layer, status); };
    if (this.layer !== null && this.status !== null) queued(this.layer, this.status); else this.pending.push(queued);
    return () => { live = false; const at = this.pending.indexOf(queued); if (at !== -1) this.pending.splice(at, 1); };
  }

  onLayer(f: (layer: HTMLElement) => void): () => void { return this.run((layer) => { f(layer); }); }

  /** Cancel delayed placement as well as removing the node; parked snapshots cannot resurrect it. */
  discard(el: HTMLElement): void {
    this.cancels.get(el)?.(); this.cancels.delete(el); this.placements.delete(el); this.owners.delete(el); el.remove();
    const holds = this.holds.get(el) ?? []; this.holds.delete(el);
    for (const release of holds) release();
  }

  /** a row of the top-left status column; `order` from ROW (a shard's own rows go after the base's). `box: false` keeps
   *  the element's own box (the base's VITALS / ammo strips, game.css) instead of the shared row glass */
  statusRow(el: HTMLElement, order: number, box = true): void {
    if (box) el.classList.add('ws-touch-row');
    el.style.order = String(order);
    this.cancels.set(el, this.run((_l, status) => { status.append(el); }));
  }

  /** a tappable tag under the status column (it flows with the rows above it) */
  pill(el: HTMLElement, onTap: () => void, scope: Scope): void {
    this.owners.set(el, scope);
    el.classList.add('ws-touch-tag');
    el.style.order = String(ROW.pill);
    // the layer cancels its touch events (TouchControls, E46), so there is no click: act on the pointer's release
    this.hold(el, scope.listen(el, 'pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); }),
      scope.listen(el, 'pointerup', (e) => { e.stopPropagation(); onTap(); }));
    this.cancels.set(el, this.run((_l, status) => { status.append(el); }));
    this.hold(el, scope.capture('nodes', () => { this.discard(el); }));
  }

  /** a round control disc at `spot`, with the base's press plumbing; hidden until `.show` */
  disc(o: DiscOpts, scope: Scope): HTMLButtonElement {
    const b = document.createElement('button');
    this.owners.set(b, scope);
    b.type = 'button';
    b.className = `ws-touch-disc at at-${o.spot} ${o.cls}`;
    b.innerHTML = o.icon; // Platform-owned SVG; the authored label is a separate text node.
    const label = document.createElement('span'); label.textContent = o.label; b.append(label);
    b.setAttribute('draggable', 'false');
    this.hold(b, scope.listen(b, 'pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); b.classList.add('down'); o.press?.(); }));
    const end = (e: Event): void => { e.stopPropagation(); if (!b.classList.contains('down')) return; b.classList.remove('down'); o.release?.(); };
    this.hold(b, scope.listen(b, 'pointerup', end), scope.listen(b, 'pointercancel', end), scope.listen(b, 'pointerleave', end));
    this.cancels.set(b, this.run((layer) => { layer.append(b); }));
    this.hold(b, scope.capture('nodes', () => { this.discard(b); }));
    return b;
  }

  show(el: HTMLElement, on: boolean): void { el.classList.toggle('show', on); }

  /** E155: each resident shard has its own touch layer — the host swaps the slots' state with the running shard */
  snapshot(): HudSlotsState { return { layer: this.layer, status: this.status, pending: [...this.pending], bands: this.bands, placements: new Map(this.placements) }; }
  restore(s: HudSlotsState): void { this.layer = s.layer; this.status = s.status; this.pending = [...s.pending]; this.bands = s.bands ?? DEFAULT_BANDS; this.placements = new Map(s.placements); }
}
interface HudSlotsState { bands?: readonly HudBand[]; placements?: ReadonlyMap<HTMLElement, { band: HudBand; order: number }>; layer: HTMLElement | null; status: HTMLElement | null; pending: ((layer: HTMLElement, status: HTMLElement) => void)[] }

export const hudSlots: HudSlots = new HudSlots();
