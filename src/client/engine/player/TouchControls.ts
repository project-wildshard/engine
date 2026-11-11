import { mountUi } from '../ui/ownership';
import { mountBoostLook } from '../ui/hoverBoost';
import { app } from '../app/runtime';
import { listenDom } from '../input/dom';
import type { Action, TouchStack, TouchVerbSpec } from '../input/InputService';
import { engineString } from '../../../shared/engine/strings';
/**
 * TouchControls — on-screen first-person controls for coarse-pointer devices (phones, tablets).
 *
 *   const touch = new TouchControls(player, weapons);    // no-op on mouse/trackpad devices (`touch.active === false`)
 *
 * Layout E (E42, Jake's pick from art/hud/round-10-look-zone/board.jpg), split 45 / 55 (E46, corrected in E58 — Jake: "45%
 * movement, 55% is the right hand section … consists of both the attack and the look pad … the attack button can touch the
 * dividing line on the 55 side", not three equally spaced buttons), portrait, styled in
 * src/client/engine/ui/styles/touch.css (prefix `ws-touch-`). A see-through glass control bar (67 % solid) runs across the bottom ~15 % of
 * the screen, split by a divider at 45 % (`--split`) into two thumb zones:
 *
 *  - MOVE (the bar's left 45 %): an anchored stick that is always drawn: a thin cyan ring with a glowing cyan knob resting
 *    at its centre, centred in the zone. A touch anywhere in the MOVE zone grabs it; the knob
 *    follows the thumb inside the ring. Pushing past SPRINT_AT while heading forward sprints: the ring's top arc lights and
 *    a SPRINT tag lights just above the bar over the stick. Not floating (declined in E11). The left 45 % above the bar is not a control surface.
 *  - LOOK (the bar's right 55 %, and the right 55 % of the screen above it — CoD Mobile free-look): dragging turns the
 *    camera and NEVER attacks. The LOOK pad (a dashed rounded square as wide as ATTACK, centred in the section's free part)
 *    is its visual, lit while a drag that started in the bar is looking.
 *  - ATTACK disc, in the LOOK section with its left edge on the divider, on the bar's centre line; a touch on the disc is
 *    ATTACK, never a look. Touch-down fires at once (`weapons.tryFire()`, the disc flashes); the disc then captures the touch, so a
 *    drag from it turns the camera while the finger is held. With a MELEE weapon (the Driftwood swords, `MELEE`, polled
 *    from `weapons.current.id`, the layer carries `.melee`), holding it still (under HOLD_PX of travel) for HOLD_MS starts
 *    the heavy charge (`weapons.adsHeld = true`, the `.ws-touch-charge` ring fills with `weapons.current.charge`) and lifting
 *    releases the chop (`adsHeld = false`; Sword.ts queues an early release). Only a lift or a cancel ends the hold — no
 *    pointerleave, so a thumb rolling off the disc's edge keeps the charge. A fast tap-tap-tap stays a light combo: each
 *    tap lifts before HOLD_MS. With a ranged weapon the same disc reads FIRE (fire on down, drag = look, no hold).
 *  - iOS WebKit (E46, Jake's iPhone): the layer cancels its own touch events (non-passive touchstart / touchmove /
 *    touchend), pinch gestures, dragstart / contextmenu / selectstart, and marks every element draggable="false"; with
 *    touch.css's touch-action / user-select / touch-callout / user-drag none on every element that kills the double-tap
 *    zoom, the text selection / loupe / callout and the drag-lift ghost of a long-pressed button, which had stolen the
 *    ATTACK hold (the heavy never charged). Pointer events still fire. The listeners sit on the layer only, which is
 *    hidden while the title / menus are up, so their taps (the build pill, the cards) keep their clicks.
 *  - Every look surface turns at ONE rate: LOOK_RATE × `player.lookMult` (Settings Look / Swing turn speed) × aim-assist
 *    friction — the old 1.6× LOOK-pad boost is gone (E37 audit F6), so a swipe turns the same wherever it starts.
 *  - Right-thumb arc, just above the bar at the right edge: DODGE (lower-left) and JUMP (upper-right), one size, in a short
 *    even diagonal (E63's T feel; the V DODGE disc beside it was deleted in E82).
 *    It sets `player.touchDodge` → Player.dodge (toward the stick, a backstep with it centred) and
 *    hides while swimming. Its cooldown (`player.dodgeCooldown`, E59) shows as a dark clock sweep unwinding over the disc
 *    (--cd), a cyan flash when it is back (.ready), and a tap before then only shakes the disc (.deny). While the player swims (`player.onSwimChange`) JUMP gives its spot to DIVE, a HELD button
 *    (`player.touchDive` → `player.diveHeld`); once the eye is under (`player.submerged`, polled) SURFACE appears in
 *    DODGE's spot (`player.touchSurface`, hold to come up) and hides again on surfacing.
 *  - LOCK shows while a weapon that locks is held (`.lockable` — LockOnTarget's LOCK_WEAPONS: the swords, Nalati's sabre and
 *    spear, NALATI-MERGE H3) and there is something to lock (E319: a target in reach, or locked on — else `.lock-idle`
 *    hides it and its slot stays empty; a shard verb's hint keeps it up); in Nalati's saddle (`player.ride`, `.riding`) MOVE steers the horse, so it never reads ORBIT.
 *  - AIM (ranged kit only): the iron-sights toggle latch (`weapons.adsHeld`, tap on / tap off, lit `.on`) sits up-right of
 *    the FIRE disc, clear of the pill, left of DODGE, on the same thumb. Crossing between melee and ranged drops the latch, so a sword never
 *    comes up charging and a crossbow never comes up sighted.
 *  - Nalati's bow (`.bow`, NALATI-MERGE H4 / N18): FIRE reads "HOLD = DRAW" and is the draw — held = `weapons.altHeld`,
 *    its `.ws-touch-charge` ring fills with the draw and glows `.ready` at full; lifting at full looses (`.fire` flash),
 *    lifting early lets the arrow down (`.letdown`: no shot, the ring unwinds). A drag from it aims while drawing. AIM is
 *    the zoom toggle (the same `adsHeld` latch): down the arrow, tap again to come out. No quick-fire.
 *  - SWAP: the ring + pie on the left edge under HOVER (E303 / E319, every shard) — src/client/engine/ui/WeaponStrip.ts docks it into
 *    this layer.
 *  - HOVER (E80, Jake's pick C, art/hud/round-11-hover-position/C-bar-tab-above-move.jpg): a folder tab on the bar's top
 *    edge above the MOVE label, a toggle (`player.setHover`, mirrors the H key; lit `.on` while riding).
 *  - PAUSE top-left; under it the `?perf` frame meter, then a status column (`.ws-touch-status`) that the HUD (HUD.ts) fills
 *    with the VITALS strip and, on ranged kit, the BOLTS readout — out of the thumb lane. A shard's own rows, discs and
 *    tags dock into this layer through src/client/engine/ui/hudSlots.ts (E154: one base HUD on every shard, no per-shard layout).
 *  - USE: a big band above the right-thumb arc, shown only while the HUD has an interact prompt; it dispatches the same
 *    `KeyE` the keyboard path listens for. There is no RELOAD: `weapons.tryFire()` reloads an empty weapon itself.
 *
 * During a sword lunge (`meleeLock.lunging`, AimTargets.ts) the view eases onto the locked animal — `lungeTurn`, behind
 * the aim-assist switch. Aim assist (AimAssist.ts — friction / snap-on-AIM / tracking, touch only, pause-menu switch): the
 * layer owns an `AimAssist`, feeds it every look drag, runs it from `player.preUpdate` every frame and scales the drag by
 * `assist.lookScale()`.
 *
 * Lock-on (E50, src/client/engine/player/LockOnTarget.ts, project/archive/2026-09-23-lock-on.md): the LOCK disc (J — on the right-thumb arc up-left of DODGE,
 * melee only) toggles it; its states follow `lockOn.state` (off dim / available pulsing / LOCKED filled). While locked
 * every look drag (the LOOK side, the free-look area, a drag from ATTACK) is the ±10° glance that springs back, a FLICK on
 * the LOOK side (≥ 28 px at ≥ 600 px/s within 200 ms) switches target, the LOOK pad reads SWITCH ‹ ›, MOVE reads ORBIT
 * with an arc lit on the pushed side, and aim assist / the lunge turn stand down. A short tap on an enemy above the bar
 * locks it. A shard's traversal verb may re-dress LOCK and JUMP (`relabel()`, ShardManifest TouchRelabel, E286: Nine Dragon's
 * GRAPPLE / LOCKED / ZIP in the grapple's gold); every other shard keeps them as they are.
 * Talks to the player through `player.touchMove / touchSprint / touchJump / touchDodge / touchDive / touchSurface`
 * (analog, summed with WASD) and to the held weapon through the EquipmentService manager's `tryFire() / adsHeld / enabled / swap()`
 * (EquipmentService.ts). The layer only receives events once the intro is gone (`#hud.intro` hides it), and never needs pointer
 * lock — iOS has none.
 */
import type { Player } from './Player';
import type { EquipmentService } from '../combat/EquipmentService';
import { AimAssist } from './AimAssist';
import { lockOn, meleeLock } from './AimTargets';
import { FlickTracker, addLockOffset, type LockOnSystem } from './LockOnTarget';
import { getSetting } from '../ui/Settings';
import { hudSlots, type DiscSpot, type TouchRelabel } from '../ui/hudSlots';

export const IS_TOUCH: boolean = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const STICK_RADIUS = 48;      // px from base to full deflection — the ring's radius, so the knob's centre reaches the ring at full push
const DEADZONE = 0.12;
const SPRINT_AT = 0.85;
// ONE look rate on every surface (E42, audit F6 / R17): the free-look rate above the bar, 0.0095 rad/px (≈ 0.54°/px, a 200 px
// swipe turns ~110°). The LOOK pad's old 1.6× boost is dropped rather than applied everywhere: pointer capture lets a drag
// that starts in the bar run up the screen, so the pad no longer needs extra reach, and the Look speed slider scales it all.
const LOOK_RATE = 0.0095;
const HOLD_PX = 12;           // an ATTACK touch that travels less than this …
const HOLD_MS = 250;          // … and is still down after this starts the heavy charge (melee only)
const LUNGE_TURN_RATE = 6;    // /s — exponential ease of the lunge camera turn (≈ 60 % of the bearing over a 0.15 s lunge)
const LUNGE_TURN_MAX = 150 * Math.PI / 180; // rad/s cap on it
const LOCK_LINGER = 0.8;       // s — E319: LOCK stays up this long after the last lockable target leaves its reach
const ACTION_DISCS = [['.ws-touch-attack', 'attack'], ['.aim', 'aim'], ['.jump', 'jump'], ['.dodge', 'dodge'], ['.ws-touch-hover', 'hover']] as const;
const RELABEL_SPOTS = ['r0', 'lock', 'jump'] as const;

/** a disc a shard's traversal verb may re-dress (ShardManifest TouchRelabel): its button, label, icon and own label / icon */
interface HintDisc { btn: HTMLElement; label: HTMLElement; svg: Element; ownIcon: readonly Node[]; hint: TouchRelabel | null }

/** a control the layer's own markup (above) must contain — a miss is a template typo, not a runtime state */
function el(parent: ParentNode, sel: string): HTMLElement {
  const e = parent.querySelector<HTMLElement>(sel);
  if (e === null) throw new Error(`TouchControls: missing ${sel}`);
  return e;
}

/** the touch HUD: the move stick, the look surface and the action discs (attack, aim, dodge, jump, lock …) */
export class TouchControls {
  private touchMode = ''; private touchLockable = false;
  private readonly scope = (app.levelScope ?? app.engineScope).child('touch');
  readonly active: boolean;
  private stickPointer = -1; private lookPointer = -1; private attackPointer = -1;
  private stickBase = { x: 0, y: 0 };
  private lookLast = { x: 0, y: 0 };
  private attackLast = { x: 0, y: 0 }; private attackPath = 0; private attackT0 = 0; // the ATTACK touch: last spot, px travelled, start time
  private heavyHeld = false; // the ATTACK hold became a heavy charge (weapons.adsHeld is ours to release)
  private stick?: HTMLElement; private knob?: HTMLElement;
  readonly assist?: AimAssist;
  private lookFrameDist = 0; private lookSpeed = 0; // px dragged on any look surface since the last frame / smoothed px/s
  private wasSubmerged = false; // the SURFACE disc follows player.submerged
  private wasMelee = false; // the AIM disc hides while a melee weapon is held
  private wasBow = false; // a bow is held (.bow — Pine Hollow's Warden's Longbow, Nalati's bow): FIRE is hold-to-draw with the draw ring
  private drawHeld = false; // the FIRE touch is the bow's draw (weapons.altHeld is ours to release)
  private chargeShown = -1; // the ATTACK disc's heavy ring (--charge) as last painted
  private cdShown = -1; // the DODGE disc's cooldown sweep (--cd) as last painted
  private lockShown = ''; private orbitShown = 0; // the lock-on state / the lit ORBIT arc as last painted (E50)
  private readonly flick = new FlickTracker(); private lookT0 = 0; private lookDown = { x: 0, y: 0 }; private lookInBar = false;
  private wasThrowing = false; // THROW replaces AIM while a throwing weapon is held (touch mode 'throwing')
  private wasLockable = false; // the LOCK disc shows while a weapon that locks is held (LOCK_WEAPONS: the swords, Nalati's sabre + spear)
  private lockLinger = 0; private lockIdle = false; // E319: s left before LOCK hides with nothing to lock / `.lock-idle` as last painted
  private wasRiding = false; // in Nalati's saddle MOVE steers the horse: it never reads ORBIT (`.riding`)
  private hintLock?: HintDisc; private hintJump?: HintDisc; // LOCK / JUMP as a shard's traversal verb re-dresses them (E286)
  private hintAttackMelee?: HintDisc; private hintAttackRanged?: HintDisc;

  private player: Player;
  private weapons: EquipmentService;
  private lock: LockOnSystem | undefined;
  constructor(player: Player, weapons: EquipmentService, force = false, lock?: LockOnSystem) {
    this.player = player;
    this.weapons = weapons;
    this.lock = lock;
    this.active = force || IS_TOUCH;
    if (!this.active) return;
    const hud = document.getElementById('hud') ?? document.body;
    hud.classList.add('touch');
    const root = document.createElement('div');
    root.className = 'ws-touch';
    root.innerHTML = engineString('s_d27c19bf3c27');
    mountUi(root, this.scope, hud);
    this.scope.onDispose(() => { root.remove(); });
    // ── iOS WebKit hardening (E46 — Jake's iPhone): a long press on a button lifted a drag preview of the ATTACK disc (and
    //    fired pointercancel, so the heavy never charged), a quick double tap zoomed, a press selected text. Pointer events
    //    still fire when the touch events are cancelled, so: cancel every touch on the layer (kills double-tap zoom, the
    //    long-press selection / callout / loupe / drag lift), no pinch, nothing draggable, no context menu or selection.
    //    touch.css adds touch-action: none + user-select / touch-callout / user-drag none on every element of the layer. ──
    const cancel = (e: Event): void => { if (e.cancelable) e.preventDefault(); };
    for (const t of ['touchstart', 'touchmove', 'touchend'] as const) listenDom(this.scope, root, t, cancel, { passive: false });
    for (const t of ['dragstart', 'contextmenu', 'selectstart'] as const) listenDom(this.scope, root, t, cancel);
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) listenDom(this.scope, document, t, cancel, { passive: false });
    for (const n of root.querySelectorAll('*')) n.setAttribute('draggable', 'false');
    // E154: the one base layer every shard shares — whatever a shard adds (a status row, a disc in a named slot, a tag) goes
    // through src/client/engine/ui/hudSlots.ts, which docks it here and nowhere else
    hudSlots.mount(root, el(root, '.ws-touch-status'));
    const stick = this.stick = el(root, '.ws-touch-stick');
    this.knob = el(stick, 'i');
    const moveZone = el(root, '.ws-touch-zone.move'), lookpad = el(root, '.ws-touch-lookpad');
    const lockBtn = el(root, '.ws-touch-disc.lock'), lockLabel = el(lockBtn, 'span'), lookLabel = el(lookpad, 'span'), moveLabel = el(moveZone, '.ws-touch-label');
    const hintDisc = (btn: HTMLElement): HintDisc => { const svg = el(btn, 'svg'); return { btn, label: el(btn, 'span'), svg, ownIcon: [...svg.childNodes].map((node) => node.cloneNode(true)), hint: null }; };
    const hintLock = this.hintLock = hintDisc(lockBtn);
    this.hintJump = hintDisc(el(root, '.ws-touch-disc.jump'));
    const attackDisc = el(root, '.ws-touch-attack');
    for (const mode of ['melee', 'ranged'] as const) {
      const svg = el(attackDisc, `svg.${mode}`);
      const hint: HintDisc = { btn: attackDisc, label: el(attackDisc, `span.${mode}`), svg, ownIcon: [...svg.childNodes].map((node) => node.cloneNode(true)), hint: null };
      if (mode === 'melee') this.hintAttackMelee = hint; else this.hintAttackRanged = hint;
    }
    // Build hint targets before the sink's first synchronous layout paint.
    // The input service hands back one frozen layout until its contexts change, so the action discs' visibility (a pure
    // function of the layout) is set once per layout; labels (lock state) and verbs (show predicates) still paint each frame.
    let shown: TouchStack | undefined;
    app.input.touchStackSink((layout) => {
      this.touchMode = layout.mode; this.touchLockable = layout.lockable;
      if (layout !== shown) {
        shown = layout;
        const live = new Set(layout.actions);
        for (const [selector, action] of ACTION_DISCS) {
          el(root, selector).style.visibility = live.has(action) || (action === 'jump' && live.has('dive')) || (action === 'dodge' && live.has('surface')) ? '' : 'hidden';
        }
      }
      for (const spot of RELABEL_SPOTS) this.relabel(spot, layout.labels[spot] ?? null);
      this.paintVerbs(root, layout.verbs);
    }, this.scope);

    // ── aim assist: runs at the top of every player update (before the camera is posed) so a nudge shows the same frame ──
    const assist = this.assist = new AimAssist();
    const aim = el(root, '.aim'), attack = el(root, '.ws-touch-attack'), dodge = el(root, '.dodge');
    const prevPre = player.preUpdate;
    this.scope.onDispose(() => { if (prevPre === undefined) delete player.preUpdate; else player.preUpdate = prevPre; });
    player.preUpdate = (dt) => {
      prevPre?.(dt);
      const speed = dt > 0 ? this.lookFrameDist / dt : 0; this.lookFrameDist = 0;
      this.lookSpeed += (speed - this.lookSpeed) * Math.min(1, dt * 15);
      if (weapons.enabled && lockOn.state !== 'locked') assist.update(dt, player, weapons.adsHeld, this.lookSpeed); // locked (E50): the lock aims, not the assist
      // AIM (ranged latch) and the ATTACK hold-heavy (melee) share `weapons.adsHeld`; crossing between the two drops it, so a
      // sword never comes up charging and a crossbow never comes up sighted from the other's latch
      const melee = this.touchMode === 'melee', throwing = this.touchMode === 'throwing';
      if (melee !== this.wasMelee || throwing !== this.wasThrowing) {
        this.wasMelee = melee; this.wasThrowing = throwing; root.classList.toggle('melee', melee); root.classList.toggle('throwing', throwing);
        if (weapons.adsHeld) weapons.adsHeld = false;
        if (weapons.altHeld) weapons.altHeld = false;
        this.heavyHeld = false;
        aim.classList.remove('on'); attack.classList.remove('on');
      }
      const lockable = this.touchLockable, riding = player.ride !== null;
      if (lockable !== this.wasLockable) { this.wasLockable = lockable; root.classList.toggle('lockable', lockable); }
      if (riding !== this.wasRiding) { this.wasRiding = riding; root.classList.toggle('riding', riding); this.lockShown = ''; }
      const bow = this.touchMode === 'bow';
      if (bow !== this.wasBow) {
        this.wasBow = bow; root.classList.toggle('bow', bow);
        if (!bow && this.drawHeld) { this.drawHeld = false; weapons.altHeld = false; }
        attack.classList.remove('on', 'ready'); this.chargeShown = -1;
      }
      if (bow) {
        // the FIRE disc's draw ring (N18): fills with the draw while held, closes and glows (.ready) at full; a let-down
        // unwinds it (the ring stays lit while the string eases forward)
        const c = weapons.current.charge ?? 0;
        if (c !== this.chargeShown) { this.chargeShown = c; attack.style.setProperty('--charge', c.toFixed(3)); attack.classList.toggle('ready', c >= 0.999); }
        attack.classList.toggle('on', this.drawHeld || c > 0.01);
      }
      if (melee) {
        // ATTACK held still past HOLD_MS → the heavy charge (released on lift). A fast tap lifts first and stays a light swing.
        if (this.attackPointer >= 0 && !this.heavyHeld && weapons.enabled && this.attackPath < HOLD_PX && performance.now() - this.attackT0 >= HOLD_MS) {
          this.heavyHeld = true; weapons.adsHeld = true; attack.classList.add('on');
        }
        const c = weapons.current.charge ?? 0;
        if (c !== this.chargeShown) { this.chargeShown = c; attack.style.setProperty('--charge', c.toFixed(3)); attack.classList.toggle('ready', c >= 1); }
        if (lockOn.state !== 'locked') this.lungeTurn(dt); // locked: the lock's camera track already faces the target
      }
      // lock-on (E50): LOCK's three states (off dim / available pulse / LOCKED filled), SWITCH on the LOOK pad, ORBIT on MOVE
      const ls = lockOn.state;
      if (ls !== this.lockShown) {
        this.lockShown = ls;
        root.classList.toggle('lock-available', ls === 'available'); root.classList.toggle('locked', ls === 'locked');
        lockLabel.textContent = hintLock.hint?.label ?? (ls === 'locked' ? engineString('s_a424e33d9093') : engineString('s_db44b8db4f05')); lookLabel.textContent = ls === 'locked' ? engineString('s_39921a740bf2') : engineString('s_a0de5719f595'); moveLabel.textContent = ls === 'locked' && !riding ? engineString('s_29ac7e56b3b4') : engineString('s_6ecc3df6bffd');
      }
      // E319 (Jake: "only LOCK contextual" — DODGE stays): LOCK shows only while pressing it would lock (`available`: a
      // target in LockOnTarget's reach, cone and sight) or while locked, and lingers LOCK_LINGER s after, so a target at
      // the cone's edge doesn't blink it. Hidden (`.lock-idle`), its slot stays empty; an E286 hint keeps it up (touch.css).
      // Without a lock system (the dev pages) it never hides.
      if (this.lock !== undefined) {
        this.lockLinger = ls === 'off' ? Math.max(0, this.lockLinger - dt) : LOCK_LINGER;
        const idle = this.lockLinger <= 0;
        if (idle !== this.lockIdle) { this.lockIdle = idle; root.classList.toggle('lock-idle', idle); }
      }
      const orbit = ls === 'locked' && !riding ? Math.sign(Math.round(player.touchMove.x * 3) / 3) : 0;
      if (orbit !== this.orbitShown) { this.orbitShown = orbit; root.classList.toggle('orbit-l', orbit < 0); root.classList.toggle('orbit-r', orbit > 0); }
      // DODGE cooldown (E59): a dark clock sweep unwinds over the disc (--cd 1 → 0) and it flashes .ready when it is back
      const cd = Math.round(player.dodgeCooldown * 100) / 100;
      if (cd !== this.cdShown) {
        if (cd === 0 && this.cdShown > 0) { dodge.classList.remove('ready'); void dodge.offsetWidth; dodge.classList.add('ready'); }
        dodge.style.setProperty('--cd', String(cd)); dodge.classList.toggle('cooling', cd > 0);
        this.cdShown = cd;
      }
      if (player.submerged !== this.wasSubmerged) { this.wasSubmerged = player.submerged; root.classList.toggle('submerged', player.submerged); if (!player.submerged) player.touchSurface = false; }
    };

    // ── stick + look: pointer events on the layer itself (buttons stop propagation; ATTACK hands its touch back via capture) ──
    listenDom(this.scope, root, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && !force) return;
      const zone = moveZone.getBoundingClientRect();
      const inBar = e.clientY >= zone.top, inMove = inBar && e.clientX <= zone.right;
      if (!inBar && e.clientX <= zone.right) return; // above the bar on the left: not a control surface
      if (inMove && this.stickPointer < 0) {
        this.stickPointer = e.pointerId;
        // the stick is anchored (its ring's centre, left of the ATTACK disc); a touch anywhere in the MOVE zone grabs it
        const ring = stick.getBoundingClientRect();
        this.stickBase = { x: ring.left + ring.width / 2, y: ring.top + ring.height / 2 };
        stick.classList.add('held');
        this.applyStick(e.clientX - this.stickBase.x, e.clientY - this.stickBase.y);
      } else if (!inMove && this.lookPointer < 0) {
        // the whole right 55 % looks (the bar's LOOK section, the screen above it) — and never attacks. A drag that starts in
        // the bar lights the LOOK pad while it lasts.
        this.lookPointer = e.pointerId;
        this.lookLast = { x: e.clientX, y: e.clientY };
        this.lookDown = { x: e.clientX, y: e.clientY }; this.lookT0 = performance.now(); this.lookInBar = inBar;
        this.flick.begin(e.clientX, e.clientY, this.lookT0);
        lookpad.classList.toggle('active', inBar);
      } else return;
      root.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    listenDom(this.scope, root, 'pointermove', (e) => {
      if (e.pointerId === this.stickPointer) {
        this.applyStick(e.clientX - this.stickBase.x, e.clientY - this.stickBase.y);
      } else if (e.pointerId === this.lookPointer) {
        // locked (E50 §2.5): a flick switches target, anything slower is the glance
        const f = lockOn.state === 'locked' ? this.flick.move(e.clientX, e.clientY, performance.now()) : null;
        if (f !== null) this.lock?.flick(f);
        else this.look(e.clientX - this.lookLast.x, e.clientY - this.lookLast.y);
        this.lookLast = { x: e.clientX, y: e.clientY };
      } else if (e.pointerId === this.attackPointer) {
        const dx = e.clientX - this.attackLast.x, dy = e.clientY - this.attackLast.y;
        this.attackLast = { x: e.clientX, y: e.clientY };
        this.attackPath += Math.hypot(dx, dy);
        this.look(dx, dy);
      }
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId === this.stickPointer) {
        this.stickPointer = -1;
        stick.classList.remove('held');
        this.player.touchMove.x = this.player.touchMove.y = 0;
        this.player.touchSprint = false;
        stick.classList.remove('sprint');
        this.showKnob(0, 0);
      } else if (e.pointerId === this.lookPointer) {
        this.lookPointer = -1;
        lookpad.classList.remove('active');
        // a short tap on an enemy above the bar locks it (E50 L11) — the look area never attacks, so a tap there is free
        if (e.type === 'pointerup' && !this.lookInBar && performance.now() - this.lookT0 < 220 && Math.hypot(e.clientX - this.lookDown.x, e.clientY - this.lookDown.y) < 12) this.lock?.tapLock(e.clientX, e.clientY);
      } else if (e.pointerId === this.attackPointer) {
        this.attackPointer = -1;
        attack.classList.remove('down');
        // lifting a heavy hold releases the chop (Sword.ts queues it if the charge is not full yet)
        if (this.heavyHeld) { this.heavyHeld = false; this.weapons.adsHeld = false; attack.classList.remove('on'); }
        // lifting the bow's draw: at full draw it looses (the disc flashes); before it, the arrow is let down (.letdown)
        if (this.drawHeld) {
          this.drawHeld = false;
          const full = (this.weapons.current.charge ?? 0) >= 0.999;
          this.weapons.altHeld = false;
          const cls = full ? 'fire' : 'letdown';
          attack.classList.remove('fire', 'letdown'); void attack.offsetWidth; attack.classList.add(cls);
        }
      }
    };
    listenDom(this.scope, root, 'pointerup', release);
    listenDom(this.scope, root, 'pointercancel', release);

    // ── ATTACK / FIRE: fires on touch-down; the disc then captures the touch (its move / up events bubble to the layer's
    //    handlers above), so a drag from it turns the camera while the finger is held and a still hold (melee) becomes the
    //    heavy — see preUpdate. Only a lift (pointerup) or a cancel ends it: no pointerleave, so a thumb rolling off the
    //    disc's edge keeps the charge, and a lost capture doesn't end it either. ──
    listenDom(this.scope, attack, 'pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      if (e.pointerType === 'mouse' && !force) return;
      if (this.attackPointer >= 0) return; // one finger on the disc at a time
      this.attackPointer = e.pointerId;
      this.attackLast = { x: e.clientX, y: e.clientY }; this.attackPath = 0; this.attackT0 = performance.now();
      attack.setPointerCapture(e.pointerId);
      attack.classList.add('down');
      if (!this.weapons.enabled) return;
      this.weapons.tryFire(); // the bow: only the dry click on an empty quiver — its draw is the hold
      if (this.wasBow) { this.drawHeld = true; this.weapons.altHeld = true; attack.classList.add('on'); return; } // flashes on the loose (release)
      attack.classList.remove('fire'); void attack.offsetWidth; attack.classList.add('fire'); // restart the swing flash
    });

    // ── buttons ──
    const btn = (sel: string, down: () => void, up?: () => void) => {
      const b = el(root, sel);
      listenDom(this.scope, b, 'pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); b.classList.add('down'); down(); });
      const end = (e: Event) => { e.stopPropagation(); b.classList.remove('down'); up?.(); };
      listenDom(this.scope, b, 'pointerup', end); listenDom(this.scope, b, 'pointercancel', end); listenDom(this.scope, b, 'pointerleave', end);
    };
    // AIM (ranged only) is a toggle, not a hold: each press flips the iron-sights latch and the disc stays lit (.on) while latched
    listenDom(this.scope, aim, 'pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.weapons.adsHeld = !this.weapons.adsHeld; aim.classList.toggle('on', this.weapons.adsHeld); });
    listenDom(this.scope, aim, 'pointerup', (e) => e.stopPropagation());
    // LOCK (E50, the J disc): a toggle — lock the enemy nearest the centre, tap again to release; with nothing lockable it
    // flashes NO TARGET and the view re-levels (LockOnTarget.toggle)
    btn('.ws-touch-disc.lock', () => { if (this.weapons.enabled) this.lock?.toggle(); });
    if (this.lock) {
      app.events.on('lock.noTarget', () => { lockBtn.classList.remove('none'); void lockBtn.offsetWidth; lockBtn.classList.add('none'); lockLabel.textContent = engineString('s_4b33d955f9a8'); this.scope.timeout(700, () => { if (lockOn.state !== 'locked') lockLabel.textContent = hintLock.hint?.label ?? engineString('s_db44b8db4f05'); }); }, this.scope);
    }
    // DODGE (Player.dodge, project/archive/2026-09-29-dodge-feel.md — E63's T feel, V deleted in E82). A tap during the cooldown only
    // shakes the disc (.deny) — no dodge is queued (E59)
    {
      const d = el(root, '.dodge');
      btn('.dodge', () => {
        if (!this.weapons.enabled) return;
        if (this.player.dodgeCooldown > 0) { d.classList.remove('deny'); void d.offsetWidth; d.classList.add('deny'); }
        app.input.press('dodge');
      });
    }
    // HOVER (the tab over MOVE, E80) is a toggle too; the H key flips the same state, so the lit look follows the player, not the button
    const hover = el(root, '.ws-touch-hover');
    listenDom(this.scope, hover, 'pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); app.input.press('hover'); });
    listenDom(this.scope, hover, 'pointerup', (e) => e.stopPropagation());
    app.events.on('player.hover', (on) => { hover.classList.toggle('on', on); }, this.scope);
    hover.classList.toggle('on', this.player.hover);
    // QA row 42: no BOOST button; a double tap of this tab latches Developer boost and turns it amber (ui/hoverBoost.ts)
    mountBoostLook(hover, this.player, app.events, this.scope);
    btn('.jump', () => { app.input.press('jump'); });
    // a throwing weapon (touch mode 'throwing'): THROW = hold to wind a javelin up, release to throw
    btn('.throw', () => { if (this.weapons.enabled) this.weapons.adsHeld = true; }, () => { this.weapons.adsHeld = false; });
    // DIVE replaces JUMP while swimming: a held control (down = held), released on up / cancel / leave
    btn('.dive', () => { this.player.touchDive = true; }, () => { this.player.touchDive = false; });
    app.events.on('player.swim', (on) => { root.classList.toggle('swimming', on); if (!on) { this.player.touchDive = false; this.player.touchSurface = false; root.classList.remove('submerged'); } }, this.scope);
    root.classList.toggle('swimming', this.player.swimming);
    // SURFACE appears beside DIVE (in DODGE's spot; DODGE hides while swimming) while the eye is under (held: up = release); it goes with the swim state on climb-out.
    // Polled from `player.submerged` every frame (in preUpdate above) rather than hooked on onSubmerge / onSurface, so
    // main.ts can assign those callbacks freely (audio) without having to chain ours.
    btn('.surface', () => { this.player.touchSurface = true; }, () => { this.player.touchSurface = false; });
    root.classList.toggle('submerged', this.player.submerged);
    btn('.ws-touch-pause', () => { app.input.press('pause'); });
    btn('.ws-touch-use', () => { app.input.pressGesture('use'); });
    // the interact prompt ("[E] Open door") becomes a big USE band above the right-thumb arc, labelled with the action
    const use = el(root, '.ws-touch-use');
    const bindPrompt = (prompt: HTMLElement) => {
      const sync = () => {
        const on = prompt.classList.contains('show');
        use.classList.toggle('show', on);
        if (on) use.textContent = prompt.textContent.replace(/^[A-Z]\s*/, '').trim() || engineString('s_c36d819e7bc6');
      };
      const observer = new MutationObserver(sync);
      this.scope.onDispose(() => { observer.disconnect(); });
      observer.observe(prompt, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
      sync();
    };
    // the HUD may be built after this layer (main.ts order) — wait for the prompt element to appear
    const found = hud.querySelector<HTMLElement>('.ws-game-prompt');
    if (found) bindPrompt(found);
    else {
      const mo = new MutationObserver(() => { const p = hud.querySelector<HTMLElement>('.ws-game-prompt'); if (p) { mo.disconnect(); bindPrompt(p); } });
      this.scope.onDispose(() => { mo.disconnect(); });
      mo.observe(hud, { childList: true });
    }
  }

  private readonly verbs = new Map<string, HTMLButtonElement>();
  private readonly verbActions: Partial<Record<'verb.1' | 'verb.2', Action>> = {};
  private readonly heldVerbs = new Map<string, Action>();
  private paintVerbs(root: HTMLElement, verbs: Partial<Record<'verb.1' | 'verb.2', TouchVerbSpec>>): void {
    for (const slot of ['verb.1', 'verb.2'] as const) {
      const spec = verbs[slot], verb = typeof spec === 'string' ? { action: spec, label: spec, icon: '' } : spec;
      let button = this.verbs.get(slot);
      const visible = verb !== undefined && verb.show?.() !== false;
      if (!visible) {
        if (button !== undefined) { if (button.style.display !== 'none') button.style.display = 'none'; button.classList.toggle('show', false); }
        const held = this.heldVerbs.get(slot); if (held !== undefined) { this.heldVerbs.delete(slot); app.input.setHeld(held, false); }
        delete this.verbActions[slot]; delete this.verbSpecs[slot];
        continue;
      }
      if (verb.element !== undefined) { button = verb.element; this.verbs.set(slot, button); }
      if (button === undefined) {
        button = document.createElement('button'); button.type = 'button';
        const own = button; root.append(own); this.verbs.set(slot, own);
        const pointers = new Set<number>();
        listenDom(this.scope, own, 'pointerdown', (event) => {
          event.preventDefault(); event.stopPropagation(); pointers.add(event.pointerId); own.setPointerCapture(event.pointerId);
          const current = this.verbActions[slot]; if (current === undefined || pointers.size !== 1) return;
          const live = this.verbSpecs[slot];
          if (live?.hold === true) { this.heldVerbs.set(slot, current); app.input.setHeld(current, true); } else app.input.press(current);
        });
        const release = (event: PointerEvent): void => {
          event.stopPropagation(); pointers.delete(event.pointerId); if (pointers.size > 0) return;
          const held = this.heldVerbs.get(slot); if (held !== undefined) { this.heldVerbs.delete(slot); app.input.setHeld(held, false); }
        };
        listenDom(this.scope, own, 'pointerup', release); listenDom(this.scope, own, 'pointercancel', release);
        this.scope.onDispose(() => { const held = this.heldVerbs.get(slot); if (held !== undefined) app.input.setHeld(held, false); });
      }
      // FC14: every frame repaints the slot, so each write is a no-op unless its value changed
      button.classList.toggle('ws-touch-verb', true); button.classList.toggle(slot === 'verb.1' ? 'verb-one' : 'verb-two', true);
      if (!button.classList.contains('at-edge-l')) { button.classList.toggle('at', false); button.classList.toggle('at-aim', false); }
      if (verb.element === undefined) button.classList.toggle('ws-touch-disc', true);
      if (button.style.display !== '') button.style.display = '';
      button.classList.toggle('show', true); if (button.hidden !== false) button.hidden = false;
      const previous = this.verbMarkup[slot];
      if (previous?.button !== button || previous.icon !== verb.icon || previous.label !== verb.label) {
        button.innerHTML = verb.icon;
        const label = document.createElement('span'); label.textContent = verb.label; button.append(label);
        this.verbMarkup[slot] = { button, icon: verb.icon, label: verb.label };
      }
      this.verbActions[slot] = verb.action; this.verbSpecs[slot] = verb;
    }
  }
  private readonly verbSpecs: Partial<Record<'verb.1' | 'verb.2', { hold?: boolean }>> = {};
  private readonly verbMarkup: Partial<Record<'verb.1' | 'verb.2', { button: HTMLElement; icon: string; label: string }>> = {};

  /**
   * A shard re-dresses ATTACK/FIRE (r0), LOCK and JUMP (scoped HUD relabels, E286: Nine Dragon's
   * GRAPPLE / LOCKED / ZIP): the label, the icon and a tone class (`.hint.hint-rest|ready|active`, accent `--hint`); null
   * gives the disc its own back. Only a change touches the DOM. A no-op without the touch layer.
   */
  relabel(spot: DiscSpot, hint: TouchRelabel | null): void {
    if (spot === 'r0') {
      const attack = engineString('s_852b889c1d23'), fire = engineString('s_8c1280a20004');
      const own = this.touchMode === 'melee' ? attack : fire;
      // A baseline label keeps the existing markup/classes; only authored differences dress the disc.
      const authored = hint?.label === own && hint.icon === undefined && (hint.tone ?? 'rest') === 'rest' && hint.accent === undefined ? null : hint;
      if (this.hintAttackMelee !== undefined) this.applyHint(this.hintAttackMelee, authored, attack);
      if (this.hintAttackRanged !== undefined) this.applyHint(this.hintAttackRanged, authored, fire);
    }
    if (spot === 'lock' && this.hintLock !== undefined) this.applyHint(this.hintLock, hint, lockOn.state === 'locked' ? 'Locked' : 'Lock');
    if (spot === 'jump' && this.hintJump !== undefined) this.applyHint(this.hintJump, hint, 'Jump');
  }

  private applyHint(d: HintDisc, h: TouchRelabel | null, own: string): void {
    const was = d.hint;
    if (was === h || (was !== null && h !== null && was.label === h.label && was.icon === h.icon && was.tone === h.tone && was.accent === h.accent)) return;
    d.hint = h;
    d.label.textContent = h?.label ?? own;
    if (h?.icon !== was?.icon) {
      if (h?.icon === undefined) d.svg.replaceChildren(...d.ownIcon.map((node) => node.cloneNode(true)));
      else d.svg.innerHTML = h.icon;
    }
    d.btn.classList.toggle('hint', h !== null);
    for (const t of ['rest', 'ready', 'active'] as const) d.btn.classList.toggle(`hint-${t}`, h !== null && (h.tone ?? 'rest') === t);
    if (h?.accent === undefined) d.btn.style.removeProperty('--hint');
    else d.btn.style.setProperty('--hint', h.accent);
  }

  /** during a sword lunge, ease the view onto the locked animal: ~60 % of the bearing over the dash, capped — touch only,
   *  behind the aim-assist switch (mouse aim is never moved for you) */
  private lungeTurn(dt: number): void {
    const t = meleeLock.target;
    if (!meleeLock.lunging || t === null || !getSetting('aimAssist')) return;
    const p = this.player.position;
    let d = Math.atan2(-(t.position.x - p.x), -(t.position.z - p.z)) - this.player.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d)); // wrap to ±π
    const step = d * (1 - Math.exp(-dt * LUNGE_TURN_RATE)), cap = LUNGE_TURN_MAX * dt;
    this.player.yaw += Math.max(-cap, Math.min(cap, step));
  }

  private applyStick(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy);
    const nx = len > 0 ? dx / len : 0, ny = len > 0 ? dy / len : 0; // direction from the raw delta
    const mag = Math.min(1, len / STICK_RADIUS);
    const scaled = mag < DEADZONE ? 0 : (mag - DEADZONE) / (1 - DEADZONE);
    let kx = dx, ky = dy;
    if (len > STICK_RADIUS) { kx *= STICK_RADIUS / len; ky *= STICK_RADIUS / len; } // knob stays on the ring
    this.player.touchMove.x = nx * scaled;
    this.player.touchMove.y = -ny * scaled;
    this.player.touchSprint = mag > SPRINT_AT && -ny > 0.5;
    this.stick?.classList.toggle('sprint', this.player.touchSprint); // the ring's top arc + the SPRINT tick light
    this.showKnob(kx, ky);
  }

  /** the knob inside the always-drawn ring: follows the thumb while held, back at the centre on release */
  private showKnob(dx: number, dy: number): void {
    if (this.knob !== undefined) this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** a look drag from any surface (the LOOK section, the right 55 % above the bar, an ATTACK drag): one rate × Look speed × aim-assist friction */
  private look(dx: number, dy: number): void {
    if (lockOn.state === 'locked') { const r = LOOK_RATE * this.player.lookMult; addLockOffset(-dx * r, -dy * r); return; } // locked (E50): a glance, not a turn
    this.lookFrameDist += Math.hypot(dx, dy);
    this.assist?.noteLook(dx, dy);
    const rate = LOOK_RATE * this.player.lookMult * (this.assist?.lookScale() ?? 1);
    this.player.yaw -= dx * rate;
    this.player.pitch = Math.max(-1.45, Math.min(1.45, this.player.pitch - dy * rate));
  }
}
