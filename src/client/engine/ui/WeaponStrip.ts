import type { Scope } from '../../../shared/engine/app/scope';
import { uiScope, mountUi } from './ownership';
import { engineString } from '../../../shared/engine/strings';
import type { EquipmentService } from '../combat/EquipmentService';
import type { WeaponId } from '../../../shared/engine/combat/Equipment';
import type { Weapon } from '../../../shared/engine/combat/Weapon';
import { app } from '../app/runtime';

/**
 * WeaponStrip — the one weapon-swap control of every shard, built once by main.ts.
 * E303: Jake picked B (tap = next, hold = a wheel). It replaced Pine Hollow's and Nalati's left-edge slot tabs (E154), which
 * ran into HOVER, and the SWAP pill on Driftwood and Nine Dragon. E319 (progress/e319-hud/): Jake moved it off the bar
 * ("far too easy to press by accident") to the left edge under HOVER, and picked its look — the placement board's C ring
 * and the wheel board's C pie, driven by A's touch. The left edge is the traversal column: HORSE (RideHUD) · HOVER · SWAP.
 *
 *   const strip = new WeaponStrip(weapons);   // after TouchControls (it docks into its layer on touch)
 *   game.onUpdate(() => strip.update());      // cheap: DOM writes only when the kit / held weapon / ammo changes
 *
 * Touch: a big round SWAP ring under HOVER — the held weapon inside a ring of swap arrows, its ammo on a badge, one dot per
 * owned weapon under it. It shows once a second weapon is owned (you pick one up, and the ring appears).
 * **Tap = the next weapon** (`weapons.swap()`, the Q key). **Hold = the pie**: a half-disc of wedges fanning right from the
 * ring, one per owned weapon (icon, name, ammo), the held one lit. Slide toward a wedge and let go to hold it; let go on
 * the hub (or cancel) to keep what you have. The wedge is picked by direction, so a short slide is enough.
 * Desktop (`.desk`): a hotbar bottom-centre with the key numbers, names and ammo (keys 1…N, Q = next, the mouse wheel =
 * next / previous: EquipmentService.ts). A slot can be clicked too.
 * Both show only once a second weapon is owned; the practice room's loan shows them too.
 * Styles: src/client/engine/ui/styles/touch.css (`ws-touch-swap*`, `ws-touch-pie*`, `ws-touch-strip.desk`, `ws-touch-slot*`).
 */

/** the two curved arrows around the ring (viewBox 0 0 56 56; the ring's centre is 28, 28) */
const RING_ARROWS = '<path d="M9.5 21A20 20 0 0 1 40 11.5"/><path d="M40 11.5l-5.6-.6M40 11.5l-1.3 5.4"/><path d="M46.5 35A20 20 0 0 1 16 44.5"/><path d="M16 44.5l5.6.6M16 44.5l1.3-5.4"/>';
/** the pie's hub icon (the swap arrows) */
const SWAP_ICON = '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>';
/** a press held this long opens the pie; a shorter one is a tap (next weapon) */
const HOLD_MS = 260;
/** the pie: hub and outer radius, px; it spans the right half (−90° … +90°) */
const PIE_HUB = 28, PIE_R = 128;
/** a release within this distance of the centre picks nothing (the hub); beyond it, the wedge in that direction */
const PICK_MIN = 30;

type Selection<Id> = Id | null;

interface Slot { id: WeaponId; el: HTMLElement; ammo: HTMLElement; shownAmmo: number | undefined | null; on: boolean }
interface Wedge { id: WeaponId; el: SVGPathElement; label: HTMLElement }

const SVGNS = 'http://www.w3.org/2000/svg';

export class WeaponStrip {
  readonly scope: ReturnType<typeof uiScope> = uiScope('WeaponStrip');
  readonly el: HTMLElement;
  private readonly touch: boolean;
  private slots: Slot[] = [];
  private kitKey = '';
  private readonly available: Weapon[] = [];
  private shownIds: WeaponId[] = [];
  private nextIds: WeaponId[] = [];
  private heldKey = '';
  // touch only: the ring's parts and the pie
  private ringIcon: SVGElement | null = null;
  private ringAmmo: HTMLElement | null = null;
  private shownAmmo: number | undefined | null = null;
  private dots: HTMLElement | null = null;
  private pie: HTMLElement | null = null;
  private wedges: Wedge[] = [];
  private pieCentre = { x: 0, y: 0 };
  private pick: Selection<WeaponId> = null;
  private press: { id: number; timer: ReturnType<Scope['timeout']>; open: boolean } | null = null;

  private weapons: EquipmentService;
  constructor(weapons: EquipmentService) {
    this.weapons = weapons;
    const hud = document.getElementById('hud') ?? document.body;
    const layer = hud.querySelector<HTMLElement>('.ws-touch');
    this.touch = layer !== null && hud.classList.contains('touch');
    if (this.touch && layer !== null) {
      this.el = document.createElement('button');
      this.el.className = 'ws-touch-swap';
      this.el.setAttribute('type', 'button');
      this.el.innerHTML = engineString('s_1191865a535c', [RING_ARROWS]);
      this.ringIcon = this.el.querySelector('.ws-touch-swap-icon');
      this.ringAmmo = this.el.querySelector('.ws-touch-swap-ammo');
      this.dots = this.el.querySelector('.ws-touch-swap-dots');
      this.pie = document.createElement('div');
      this.pie.className = 'ws-touch-pie';
      mountUi(this.pie, this.scope, layer); mountUi(this.el, this.scope, layer);
      this.wireRing();
    } else {
      this.el = document.createElement('div');
      this.el.className = 'ws-touch-strip desk';
      mountUi(this.el, this.scope, hud);
    }
    this.update();
  }

  update(): void {
    const w = this.weapons, list = w.availableInto(this.available), ids = this.nextIds;
    ids.length = list.length;
    let changed = ids.length !== this.shownIds.length;
    for (let index = 0; index < list.length; index++) {
      const weapon = list[index]; if (weapon === undefined) throw new Error('Missing available weapon');
      const id = weapon.id; ids[index] = id;
      if (id !== this.shownIds[index]) changed = true;
    }
    if (changed) {
      const key = ids.join(','); this.nextIds = this.shownIds; this.shownIds = ids;
      if (key !== this.kitKey) this.build(key);
    }
    const held = w.current.id;
    if (this.touch) {
      if (held !== this.heldKey) this.drawRing(held);
      const ammo = w.current.state.ammo;
      if (ammo !== this.shownAmmo && this.ringAmmo !== null) {
        this.shownAmmo = ammo;
        this.ringAmmo.textContent = ammo === undefined ? '' : String(ammo);
        this.ringAmmo.classList.toggle('empty', ammo === 0);
      }
    }
    for (const s of this.slots) {
      const on = held === s.id;
      if (on !== s.on) { s.on = on; s.el.classList.toggle('on', on); }
      const ammo = w.get(s.id).state.ammo;
      if (ammo !== s.shownAmmo) { s.shownAmmo = ammo; s.ammo.textContent = ammo === undefined ? '' : String(ammo); s.ammo.classList.toggle('empty', ammo === 0); }
    }
  }

  private build(key: string): void {
    this.kitKey = key; this.heldKey = '';
    this.closePie();
    const list = this.weapons.available;
    this.el.classList.toggle('show', list.length > 1);
    this.slots = [];
    if (this.touch) {
      // the pie's wedges are rebuilt on every open (they follow where the ring sits); only the dots live here
      this.dots?.replaceChildren(...list.map(() => document.createElement('i')));
      return;
    }
    this.el.replaceChildren();
    list.forEach((k, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ws-touch-slot';
      const keyLabel = document.createElement('i'); keyLabel.className = 'ws-touch-slot-key'; keyLabel.textContent = String(i + 1);
      const glyph = document.createElementNS(SVGNS, 'svg'); glyph.setAttribute('viewBox', '0 0 24 24'); glyph.innerHTML = k.row.ui.swapIcon;
      const name = document.createElement('span'); name.className = 'ws-touch-slot-name'; name.textContent = k.row.ui.swapName ?? k.row.ui.name;
      const ammo = document.createElement('b'); ammo.className = 'ws-touch-slot-ammo';
      b.append(keyLabel, glyph, name, ammo);
      this.scope.listen(b, 'pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        if (this.weapons.enabled) app.input.press(`swap.weapon.${String(k.id)}`);
      });
      this.el.append(b);
      this.slots.push({ id: k.id, el: b, ammo, shownAmmo: null, on: false });
    });
  }

  /** the ring shows the held weapon; its dot lights */
  private drawRing(held: WeaponId): void {
    this.heldKey = held;
    if (this.ringIcon !== null) this.ringIcon.innerHTML = this.weapons.current.row.ui.swapIcon;
    const list = this.weapons.available, dots = this.dots?.children;
    if (dots !== undefined) list.forEach((w, i) => { dots[i]?.classList.toggle('on', w.id === held); });
  }

  private wireRing(): void {
    const ring = this.el;
    this.scope.listen(ring, 'pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      if (this.press !== null || !this.weapons.enabled) return;
      ring.setPointerCapture(e.pointerId);
      ring.classList.add('down');
      const press: NonNullable<WeaponStrip['press']> = { id: e.pointerId, timer: 0, open: false };
      press.timer = this.scope.timeout(HOLD_MS, () => { press.open = true; this.openPie(); });
      this.press = press;
    });
    this.scope.listen(ring, 'pointermove', (e) => {
      const p = this.press;
      if (p === null || e.pointerId !== p.id || !p.open) return;
      e.stopPropagation();
      this.hover(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent, cancelled: boolean): void => {
      const p = this.press;
      if (p === null || e.pointerId !== p.id) return;
      e.stopPropagation();
      this.scope.cancelTimer(p.timer);
      this.press = null;
      ring.classList.remove('down');
      if (ring.hasPointerCapture(e.pointerId)) ring.releasePointerCapture(e.pointerId);
      if (!this.weapons.enabled) { this.closePie(); return; }
      if (!p.open) { if (!cancelled) app.input.press('swap.ui'); return; }
      if (!cancelled) this.hover(e.clientX, e.clientY);
      const pick = cancelled ? null : this.pick;
      this.closePie();
      if (pick !== null && pick !== this.weapons.current.id) app.input.press(`swap.weapon.${String(pick)}`);
    };
    this.scope.listen(ring, 'pointerup', (e) => { end(e, false); });
    this.scope.listen(ring, 'pointercancel', (e) => { end(e, true); });
  }

  /** open the pie on the ring's centre: one wedge per owned weapon across the right half, the held one lit */
  private openPie(): void {
    const pie = this.pie, layer = pie?.parentElement;
    const list = this.weapons.available, n = list.length;
    if (pie === null || layer === null || layer === undefined || n < 2) return;
    const lr = layer.getBoundingClientRect(), cr = this.el.getBoundingClientRect();
    const cx = cr.left + cr.width / 2 - lr.left;
    // kept on screen top and bottom
    const cy = Math.min(lr.height - PIE_R - 8, Math.max(PIE_R + 8, cr.top + cr.height / 2 - lr.top));
    this.pieCentre = { x: lr.left + cx, y: lr.top + cy };
    pie.style.left = `${cx}px`; pie.style.top = `${cy}px`;
    pie.replaceChildren();
    this.wedges = [];
    const size = PIE_R * 2 + 4;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'ws-touch-pie-disc');
    svg.setAttribute('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`);
    svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
    pie.append(svg);
    const span = 180 / n;
    const held = this.weapons.current.id;
    const at = (r: number, a: number): string => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
    list.forEach((k, i) => {
      const a0 = (-90 + i * span) * Math.PI / 180, a1 = (-90 + (i + 1) * span) * Math.PI / 180;
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', `M ${at(PIE_HUB, a0)} L ${at(PIE_R, a0)} A ${PIE_R} ${PIE_R} 0 0 1 ${at(PIE_R, a1)} L ${at(PIE_HUB, a1)} A ${PIE_HUB} ${PIE_HUB} 0 0 0 ${at(PIE_HUB, a0)} Z`);
      path.setAttribute('class', `ws-touch-pie-wedge${k.id === held ? ' held' : ''}`);
      svg.append(path);
      const mid = (a0 + a1) / 2, r = (PIE_HUB + PIE_R) / 2 + 6;
      const label = document.createElement('div');
      label.className = `ws-touch-pie-label${k.id === held ? ' held' : ''}`;
      label.style.transform = `translate(${(Math.cos(mid) * r).toFixed(1)}px, ${(Math.sin(mid) * r).toFixed(1)}px)`;
      const ammo = this.weapons.get(k.id).state.ammo;
      const glyph = document.createElementNS(SVGNS, 'svg'); glyph.setAttribute('viewBox', '0 0 24 24'); glyph.innerHTML = k.row.ui.swapIcon;
      const name = document.createElement('span'); name.textContent = k.row.ui.swapName ?? k.row.ui.name;
      if (ammo !== undefined) {
        const count = document.createElement('b'); count.classList.toggle('empty', ammo === 0); count.textContent = String(ammo);
        name.append(document.createTextNode(' '), count);
      }
      label.append(glyph, name);
      pie.append(label);
      this.wedges.push({ id: k.id, el: path, label });
    });
    const hub = document.createElement('div');
    hub.className = 'ws-touch-pie-hub';
    hub.innerHTML = engineString('s_3aaadf6760b9', [SWAP_ICON]);
    pie.append(hub);
    this.pick = null;
    pie.classList.add('open');
  }

  /** the wedge in the finger's direction from the centre (past the hub) is the one a release would take */
  private hover(fx: number, fy: number): void {
    const dx = fx - this.pieCentre.x, dy = fy - this.pieCentre.y;
    let best: Selection<WeaponId> = null;
    const n = this.wedges.length;
    if (n > 0 && dx * dx + dy * dy > PICK_MIN * PICK_MIN) {
      // −90° (up) … +90° (down) across the right half; a slide back left clamps to the nearest end wedge
      const deg = Math.max(-89.9, Math.min(89.9, Math.atan2(dy, Math.max(dx, 0.001)) * 180 / Math.PI));
      best = this.wedges[Math.floor((deg + 90) / (180 / n))]?.id ?? null;
    }
    if (best === this.pick) return;
    this.pick = best;
    for (const w of this.wedges) { const on = w.id === best; w.el.classList.toggle('pick', on); w.label.classList.toggle('pick', on); }
  }

  private closePie(): void {
    this.pick = null;
    this.wedges = [];
    if (this.pie === null) return;
    this.pie.classList.remove('open');
    this.pie.replaceChildren();
  }
}
