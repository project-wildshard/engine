import { diagnosticNow } from '@wildshard/engine/core/clock';
import type { TouchVerbSpec } from '@wildshard/engine/input/InputService';
import type { LevelContext } from '@wildshard/engine/level/context';
import { hudSlots, type DiscOpts } from '@wildshard/engine/ui/hudSlots';
import { uiScope } from '@wildshard/engine/ui/ownership';
import * as THREE from 'three';
import './ride.css';
import type { RideHudState } from '@wildshard/format/riding';

/** Client-only riding and taming HUD; stable baseline markup and HUD slots, driven by observations. */

export interface TamingView {
  /** the TRUST arc: 0..100, and the stallion's ALERT 0..100 with where his ear goes (world, null = hidden) */
  trust: number | null;
  alert: number;
  ear: THREE.Vector3 | null;
  /** the bucking rounds: 1..5 and the balance −1..1 (null = not breaking); `danger` = in a red end */
  round: number | null;
  balance: number;
  danger: boolean;
  /** OFFER is possible (inside 12 m, alert grey) */
  offer: boolean;
}

const SVG_HORSE = '<svg viewBox="0 0 24 24"><path d="M19.5 3.2c-1.6.2-3 .9-4.1 2L8.3 8.4c-1.2.5-2.2 1.4-2.8 2.6L3.6 14.8c-.3.6-.1 1.3.5 1.6.5.2 1 .1 1.4-.3l1.9-2.2.3 5.6c0 .6.5 1 1.1 1s1-.5 1-1.1l.2-3.9h4.4l.6 4c.1.6.6 1 1.2.9.6-.1 1-.6.9-1.2l-.8-5.8c1.3-.9 2.1-2.4 2.1-4l.1-1.3 1.7-.5c.6-.2.9-.8.7-1.4l-.3-1c.6-.5.8-1.4.4-2.1z"/></svg>';
const SVG_SHOE = '<svg viewBox="0 0 24 24"><path d="M12 3C7.6 3 4.5 6.6 4.5 11c0 3.4 1.5 6.8 3 9.2.3.5 1 .6 1.5.3l.8-.5c.4-.3.6-.8.3-1.3C8.7 16.6 7.5 13.8 7.5 11c0-2.8 2-5 4.5-5s4.5 2.2 4.5 5c0 2.8-1.2 5.6-2.6 7.7-.3.5-.1 1 .3 1.3l.8.5c.5.3 1.2.2 1.5-.3 1.5-2.4 3-5.8 3-9.2C19.5 6.6 16.4 3 12 3z"/></svg>';
const SVG_HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.4-9.3C1.2 8.2 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 5.8 3.7 4.4 7.2C19.5 16.4 12 21 12 21z"/></svg>';
const SVG_EAR = (col: string): string => `<svg viewBox="0 0 30 30"><path d="M9 26c-2-6-1-15 4-22 4 5 7 13 5 21-2 2-7 3-9 1z" fill="${col}" stroke="rgba(0,0,0,0.5)" stroke-width="1"/><path d="M12.5 21c-.8-4 0-9 1.8-12.5 1.8 3.4 2.6 8 1.8 12" fill="rgba(0,0,0,0.25)"/><path d="M22 10c2 2 3 5 3 8M24.5 7.5c3 3 4 7 3.6 11" fill="none" stroke="${col}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const SVG_DOWN = '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_LEFT = '<svg viewBox="0 0 24 24"><path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_RIGHT = '<svg viewBox="0 0 24 24"><path d="M9 4l8 8-8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_HAND = '<svg viewBox="0 0 24 24"><path d="M7 21c-2.2-2-3.5-4.4-3.8-7.3-.1-.7.5-1.3 1.2-1.3.5 0 .9.3 1.1.8l.9 2.3V5.2c0-.8.6-1.4 1.3-1.4s1.3.6 1.3 1.4v6h.6V3.6c0-.8.6-1.4 1.3-1.4s1.3.6 1.3 1.4v7.6h.6V4.6c0-.8.6-1.4 1.3-1.4s1.3.6 1.3 1.4v6.6h.6V7c0-.8.6-1.4 1.3-1.4s1.3.6 1.3 1.4v8.6c0 2.6-1.1 4.3-2.5 5.4z"/></svg>';

const arcPath = (cx: number, cy: number, r: number, a0: number, a1: number): string => {
  const p0x = cx + r * Math.cos(a0), p0y = cy + r * Math.sin(a0), p1x = cx + r * Math.cos(a1), p1y = cy + r * Math.sin(a1);
  return `M${p0x.toFixed(1)} ${p0y.toFixed(1)} A${r} ${r} 0 0 1 ${p1x.toFixed(1)} ${p1y.toFixed(1)}`;
};

const _p = new THREE.Vector3();

export class RideHUD {
  readonly scope: ReturnType<typeof uiScope> = uiScope('RideHUD');
  private state: RideHudState = { mounted: false, breaking: false, steed: 100, winded: false, gait: 'stand', leanLow: 0, beat: false, spurFlash: 0, spur: { latched: false, streak: 0 }, horse: null, mountables: [] };
  /** touch discs held: LEAN (−1 left, +1 right, 0 none) and OFFER */
  lean = 0;
  offer = false;
  private readonly root: HTMLElement;
  private readonly steed: HTMLElement; private readonly sbar: HTMLElement; private readonly gait: HTMLElement; private readonly sname: HTMLElement;
  private readonly trust: HTMLElement; private readonly trustFill: SVGPathElement;
  private readonly trustRow: HTMLElement; private readonly trustRowFill: HTMLElement;
  private trustShown = -1;
  private readonly ear: HTMLElement; private earCol = '';
  private readonly hold: HTMLElement; private readonly holdRound: HTMLElement; private readonly holdMark: SVGGElement;
  private readonly tags = new Map<string, { el: HTMLElement; name: HTMLElement }>();   // per horse (a rename at the rail re-labels it)
  /** the phone's controls + STEED row (hudSlots: detached, and never shown, on a mouse / trackpad device) */
  private readonly t: { gallop: HTMLElement; horse: HTMLButtonElement; leanL: HTMLElement; leanR: HTMLElement; offer: HTMLButtonElement; steed: HTMLElement; sbar: HTMLElement; sname: HTMLElement; gait: HTMLElement };
  private layer: HTMLElement | null = null; private use: HTMLElement | null = null;
  private last = { mounted: true, breaking: true, offer: true, horseTab: true, steed: -1, gait: '', winded: false, beat: false, spur: 0 }; // ≠ the first frame's: paint it
  /** Actual taming availability; the first-paint cache deliberately starts with the opposite value. */
  private offerAvailable = false;
  private spurUntil = 0;

  constructor(private readonly ctx: LevelContext, private readonly camera: THREE.PerspectiveCamera, private readonly profile: { tagRange: number; tagHeight: number }) {
    this.root = document.getElementById('hud') ?? document.body;
    const el = (cls: string, html = ''): HTMLElement => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; };
    this.steed = el('ws-glass ws-ride-steed', `<div class="ws-ride-row"><i class="ws-ride-glyph">${SVG_HORSE}</i><span class="ws-ride-name">Steed</span><span class="ws-ride-gait">stand</span></div><div class="ws-ride-sbar"><i style="width:100%"></i></div>`);
    this.sbar = this.q(this.steed, '.ws-ride-sbar i'); this.gait = this.q(this.steed, '.ws-ride-gait'); this.sname = this.q(this.steed, '.ws-ride-name');
    this.trust = el('ws-ride-trust', `<svg viewBox="0 0 260 64"><path d="${arcPath(130, 130, 118, Math.PI * 1.22, Math.PI * 1.78)}" fill="none" stroke="rgba(6,10,18,0.7)" stroke-width="12" stroke-linecap="round"/><path class="f" d="${arcPath(130, 130, 118, Math.PI * 1.22, Math.PI * 1.78)}" fill="none" stroke="url(#wsRideTrustG)" stroke-width="7" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100"/><defs><linearGradient id="wsRideTrustG" x1="0" x2="1"><stop offset="0" stop-color="#6fe8ff"/><stop offset="0.7" stop-color="#bff6ff"/><stop offset="1" stop-color="#ffd66a"/></linearGradient></defs><g transform="translate(111 2)" fill="#7fe3ff">${SVG_HEART.replace('<svg viewBox="0 0 24 24">', '<svg width="16" height="16" viewBox="0 0 24 24">')}</g><g transform="translate(133 2)" fill="#7fe3ff">${SVG_SHOE.replace('<svg viewBox="0 0 24 24">', '<svg width="16" height="16" viewBox="0 0 24 24">')}</g></svg><span class="ws-ride-cap">Trust</span>`);
    const tf = this.trust.querySelector<SVGPathElement>('path.f');
    if (tf === null) throw new Error('RideHUD: trust arc');
    this.trustFill = tf;
    this.trustRow = el('ws-ride-trustrow', '<span>Trust</span><b><i></i></b>'); this.trustRowFill = this.q(this.trustRow, 'b i');
    this.ear = el('ws-ride-ear');
    this.hold = el('ws-ride-hold', `<span class="ws-ride-round">TAMING 1/5</span><svg viewBox="0 0 340 58"><defs><linearGradient id="wsRideHoldG" x1="0" x2="1"><stop offset="0" stop-color="#ff4a3a"/><stop offset="0.22" stop-color="#ff9a3a"/><stop offset="0.36" stop-color="#43d66a"/><stop offset="0.64" stop-color="#43d66a"/><stop offset="0.78" stop-color="#ff9a3a"/><stop offset="1" stop-color="#ff4a3a"/></linearGradient></defs><path d="${arcPath(170, 250, 240, Math.PI * 1.29, Math.PI * 1.71)}" fill="none" stroke="rgba(6,10,18,0.7)" stroke-width="14" stroke-linecap="round"/><path d="${arcPath(170, 250, 240, Math.PI * 1.29, Math.PI * 1.71)}" fill="none" stroke="url(#wsRideHoldG)" stroke-width="8" stroke-linecap="round"/><g class="m"><path d="M0 -14 L0 10" stroke="#8fe3ff" stroke-width="3"/><path d="M0 -20 L9 -15 L0 -10 Z" fill="#8fe3ff"/></g></svg><span class="ws-ride-cap">Hold on</span>`);
    this.holdRound = this.q(this.hold, '.ws-ride-round');
    const mk = this.hold.querySelector<SVGGElement>('g.m');
    if (mk === null) throw new Error('RideHUD: hold marker');
    this.holdMark = mk;
    this.root.append(this.steed, this.trust, this.ear, this.hold);
    this.t = this.buildTouch();
    // QB18 (G872): on the phone the top arc ran from the GRASS row into the minimap; it is a row under GRASS instead, so
    // VISIBLE · GRASS · TRUST read as one block that crosses nothing. A desktop keeps the arc (no status column there)
    this.ctx.hud.widget('band.3', this.trustRow, 5);
    this.ctx.scope.onDispose(() => {
      this.steed.remove(); this.trust.remove(); this.ear.remove(); this.hold.remove();
      for (const tag of this.tags.values()) tag.el.remove();
      this.tags.clear();
    });
  }

  /** Context fragments retain E319's HORSE edge tab and give OFFER the reserved second verb disc. */
  inputVerbs(mounted = false): Partial<Record<'verb.1' | 'verb.2', TouchVerbSpec>> {
    return {
      'verb.1': { action: mounted ? 'ride.horseTab' : 'ride.whistle', label: mounted ? 'Dismount' : 'Horse',
        icon: mounted ? `${SVG_HORSE}<b class="ws-ride-darrow">${SVG_DOWN}</b>` : SVG_HORSE, element: this.t.horse,
        show: () => !this.state.breaking && (this.state.mounted || this.state.mountables.some((mt) => mt.whistle)) },
      'verb.2': { action: 'ride.offer', label: 'Offer', icon: SVG_HAND, hold: true, element: this.t.offer,
        show: () => this.offerAvailable },
    };
  }

  private q(r: HTMLElement, s: string): HTMLElement { const e = r.querySelector<HTMLElement>(s); if (e === null) throw new Error(`RideHUD: ${s}`); return e; }

  /** the phone's discs and STEED row, through the base HUD's slots */
  private buildTouch(): RideHUD['t'] {
    const disc = (opts: DiscOpts): HTMLButtonElement => this.ctx.hud.disc(opts);
    const gallop = disc({ cls: 'ws-ride-gallop', icon: SVG_SHOE, label: 'Gallop', spot: 'r0', press: () => { this.ctx.app.input.setHeld('ride.gallop', true); }, release: () => { this.ctx.app.input.setHeld('ride.gallop', false); } });
    // HORSE ⇄ DISMOUNT (N17): one tab on the left edge over HOVER (E319, Jake: HORSE right and HOVER left "makes no sense")
    // — on foot it whistles your horse (shown only once one is bonded), in the saddle it reads DISMOUNT and gets you off
    // (the full-width USE band's DISMOUNT hides, syncUse)
    const horse = disc({ cls: 'ws-ride-horse', icon: SVG_HORSE, label: 'Horse', spot: 'edge-l', press: () => { this.ctx.app.input.press(this.state.mounted ? 'ride.horseTab' : 'ride.whistle'); } });
    const leanL = disc({ cls: 'ws-ride-lean', icon: SVG_LEFT, label: 'Lean L', spot: 'lean-l', press: () => { this.ctx.app.input.setHeld('lean.left', true); }, release: () => { this.ctx.app.input.setHeld('lean.left', false); } });
    const leanR = disc({ cls: 'ws-ride-lean', icon: SVG_RIGHT, label: 'Lean R', spot: 'lean-r', press: () => { this.ctx.app.input.setHeld('lean.right', true); }, release: () => { this.ctx.app.input.setHeld('lean.right', false); } });
    const offer = disc({ cls: 'ws-ride-offer', icon: SVG_HAND, label: 'Offer', spot: 'aim', press: () => { this.ctx.app.input.setHeld('ride.offer', true); }, release: () => { this.ctx.app.input.setHeld('ride.offer', false); } });
    // STEED: a row of the status column under VITALS (D-saddle.jpg's content)
    const steed = document.createElement('div');
    steed.className = 'ws-ride-steed ws-ride-touch';
    steed.innerHTML = `<i class="ws-ride-glyph">${SVG_HORSE}</i><span class="ws-ride-name">Steed</span><span class="ws-ride-sbar"><i style="width:100%"></i></span><span class="ws-ride-gait">stand</span>`;
    this.ctx.hud.widget('band.3', steed, 2);
    const unlayer = hudSlots.onLayer((layer) => {
      this.layer = layer;
      this.use = layer.querySelector<HTMLElement>('.ws-touch-use');
      if (this.use !== null) {
        const observer = new MutationObserver(() => { this.syncUse(); });
        observer.observe(this.use, { childList: true, characterData: true, subtree: true });
        this.ctx.scope.onDispose(() => { observer.disconnect(); });
      }
    });
    this.ctx.scope.onDispose(unlayer);
    return { gallop, horse, leanL, leanR, offer, steed, sbar: this.q(steed, '.ws-ride-sbar i'), sname: this.q(steed, '.ws-ride-name'), gait: this.q(steed, '.ws-ride-gait') };
  }

  /** the USE band (TouchControls) reading DISMOUNT hides while the DISMOUNT tab is up; any other action in the saddle
   *  (a gate, a chest) still shows it. Event-driven (its label changes / mount changes), never per frame */
  private syncUse(): void {
    const use = this.use;
    if (use === null) return;
    const hide = this.state.mounted && use.textContent.trim().toLowerCase() === 'dismount';
    use.style.visibility = hide ? 'hidden' : '';
  }

  /** show / hide one of the base's own controls (inline, so its stylesheet stays its own) */
  private showDisc(sel: string, on: boolean): void {
    const d = this.layer?.querySelector<HTMLElement>(sel) ?? null;
    if (d !== null) d.style.visibility = on ? '' : 'hidden';
  }

  update(view: TamingView | null, state: RideHudState): void {
    this.state = state;
    const m = state, t = this.t, touch = hudSlots.touch;
    const mounted = m.mounted, breaking = m.breaking;
    // ── the saddle layout ──
    if (mounted !== this.last.mounted || breaking !== this.last.breaking) {
      this.last.mounted = mounted; this.last.breaking = breaking;
      this.steed.classList.toggle('show', mounted && !breaking && !touch);
      t.steed.classList.toggle('show', mounted && !breaking);
      hudSlots.show(t.gallop, mounted && !breaking);
      hudSlots.show(t.leanL, breaking); hudSlots.show(t.leanR, breaking);
      this.showDisc('.ws-touch-disc.jump', !mounted);
      this.showDisc('.ws-touch-disc.dodge', !mounted);
      this.showDisc('.ws-touch-hover', !mounted);   // the base's HOVER tab: no board in the saddle
      this.showDisc('.ws-touch-disc.aim', !breaking);
      t.horse.classList.toggle('ws-ride-dismount', mounted);
      t.horse.innerHTML = mounted ? `${SVG_HORSE}<b class="ws-ride-darrow">${SVG_DOWN}</b><span>Dismount</span>` : `${SVG_HORSE}<span>Horse</span>`;
      this.syncUse();
      if (!breaking) this.lean = 0;
    }
    if (mounted) {
      const s = Math.round(m.steed);
      if (s !== this.last.steed || m.winded !== this.last.winded) {
        this.last.steed = s; this.last.winded = m.winded;
        this.sbar.style.width = `${s}%`; this.steed.classList.toggle('winded', m.winded);
        t.sbar.style.width = `${s}%`; t.steed.classList.toggle('winded', m.winded); t.gallop.classList.toggle('winded', m.winded);
      }
      // B1: the rhythm spur — the gait reads "gallop »»" while taps in time hold it (a » per tap in a row)
      const rhythm = m.spur.latched && m.gait === 'gallop' ? `gallop ${'»'.repeat(Math.max(1, m.spur.streak))}` : null;
      const gait = rhythm ?? (m.leanLow > 0.5 ? 'gallop · low' : m.gait);
      if (gait !== this.last.gait) { this.last.gait = gait; this.gait.textContent = gait; t.gait.textContent = rhythm ?? m.gait; } // the phone row is 170 px: the gait alone (D-saddle.jpg)
      // B1: the GALLOP disc (the STEED panel's horse on a desktop) pulses on the stride's beat; a tap in time flashes it cyan
      if (m.beat !== this.last.beat) { this.last.beat = m.beat; t.gallop.classList.toggle('ws-ride-beat', m.beat); this.steed.classList.toggle('beat', m.beat); }
      const now = diagnosticNow();
      if (m.spurFlash !== this.last.spur) { this.last.spur = m.spurFlash; this.spurUntil = now + 220; t.gallop.classList.add('ws-ride-spur'); this.steed.classList.add('spur'); }
      else if (this.spurUntil > 0 && now > this.spurUntil) { this.spurUntil = 0; t.gallop.classList.remove('ws-ride-spur'); this.steed.classList.remove('spur'); }
      const name = m.mountables.find(actor => actor.id === m.horse)?.name ?? 'Steed';
      if (this.sname.textContent !== name) { this.sname.textContent = name; t.sname.textContent = name; }
    }
    // ── taming ──
    const trust = view?.trust ?? null, row = hudSlots.touch;
    this.trust.classList.toggle('show', trust !== null && !breaking && !row);
    this.trustRow.classList.toggle('show', trust !== null && !breaking && row);
    if (trust !== null && trust !== this.trustShown) { // FC14: only when trust moves
      this.trustShown = trust;
      this.trustFill.setAttribute('stroke-dasharray', `${Math.max(0.5, trust).toFixed(1)} 100`);
      this.trustRowFill.style.transform = `scaleX(${(Math.max(0.5, trust) / 100).toFixed(3)})`;
    }
    const ear = view?.ear ?? null;
    if (ear !== null && this.project(ear)) {
      const a = view?.alert ?? 0;
      const col = a < 33 ? '#c9d3da' : a < 70 ? '#ffb23a' : '#ff4a3a';
      if (col !== this.earCol) { this.earCol = col; this.ear.innerHTML = SVG_EAR(col); }
      this.ear.style.transform = `translate(${_p.x.toFixed(1)}px, ${_p.y.toFixed(1)}px)`;
      this.ear.classList.add('show');
    } else this.ear.classList.toggle('show', false); // FC14: every frame; writes only on change
    const round = view?.round ?? null;
    this.hold.classList.toggle('show', round !== null);
    if (round !== null && view !== null) {
      const txt = `TAMING ${round}/5`;
      if (this.holdRound.textContent !== txt) this.holdRound.textContent = txt;
      // the marker rides the arc: centre (170, 250), r 240, from 1.29π to 1.71π
      const ang = Math.PI * (1.5 + 0.21 * THREE.MathUtils.clamp(view.balance, -1, 1));
      const x = 170 + 240 * Math.cos(ang), y = 250 + 240 * Math.sin(ang);
      this.holdMark.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${((ang - Math.PI * 1.5) * 180 / Math.PI).toFixed(1)})`);
      this.hold.classList.toggle('danger', view.danger);
    }
    // HORSE: only once you have a horse to call (Taming marks the bonded one mem.whistle = 1), or while riding one
    const horseTab = !breaking && (mounted || m.mountables.some((mt) => mt.whistle));
    if (horseTab !== this.last.horseTab) { this.last.horseTab = horseTab; hudSlots.show(t.horse, horseTab); }
    const offer = (view?.offer ?? false) && !mounted;
    this.offerAvailable = offer;
    if (offer !== this.last.offer) {
      this.last.offer = offer;
      hudSlots.show(t.offer, offer);
      this.showDisc('.ws-touch-disc.aim', !offer && !breaking);
      if (!offer) this.ctx.app.input.setHeld('ride.offer', false);
    }
    // ── name tags over your horses ──
    for (const mt of m.mountables) {
      if (!mt.whistle) continue;
      let tg = this.tags.get(mt.id);
      if (tg === undefined) {
        const el = document.createElement('div'); el.className = 'ws-ride-tag';
        el.innerHTML = `${SVG_HORSE}<span></span><span class="ws-ride-heart">♥</span>`;
        const nm = el.querySelector('span');
        if (nm === null) continue;
        this.root.append(el); tg = { el, name: nm }; this.tags.set(mt.id, tg);
      }
      if (tg.name.textContent !== mt.name) tg.name.textContent = mt.name;
      const tag = tg.el;
      const d = _p.fromArray(mt.position).distanceTo(this.camera.position);
      _p.fromArray(mt.position); _p.y += this.profile.tagHeight * mt.scale;
      const vis = m.horse !== mt.id && !mt.hidden && d < this.profile.tagRange && d > 2 && this.project(_p);
      if (vis) tag.style.transform = `translate(${_p.x.toFixed(1)}px, ${_p.y.toFixed(1)}px) translate(-50%, -100%)`;
      tag.classList.toggle('show', vis);
    }
  }

  /** world → CSS px in `_p` (in place); false when behind the camera */
  private project(w: THREE.Vector3): boolean {
    _p.copy(w).project(this.camera);
    if (_p.z > 1 || _p.z < -1) return false;
    const r = this.root.getBoundingClientRect();
    _p.set((_p.x * 0.5 + 0.5) * r.width, (-_p.y * 0.5 + 0.5) * r.height, 0);
    return true;
  }
}
