import type { Vector3 } from 'three';
import { Scope } from '../../../shared/engine/app/scope';
import { emitFault } from '../../../shared/engine/core/faults';
import type { Equipment, WeaponId } from '../../../shared/engine/combat/Equipment';
import type { OwnHit, Weapon, WeaponHooks, WeaponState, AimInfo, WeaponWire } from '../../../shared/engine/combat/Weapon';
import { Tool } from '../../../shared/engine/combat/Tool';
import type { EquipmentInput } from '../input/equipmentInput';
import type { Events } from '../../../shared/engine/events/events';
import type { EquipmentPickup, EquipmentPickupHost, PickupLoadout } from '../../../server/engine/combat/EquipmentPickup';

const SWAP_TIME = 0.25, STOW_TIME = 0.25;
interface PendingSelection { readonly to: Weapon; instant: boolean; waiting: boolean; pending: Promise<void>; readonly supersede: () => void }

export class EquipmentService implements WeaponHooks {
  readonly list: Weapon[];
  current: Weapon;
  onFire?: (() => void) | undefined; onHit?: Weapon['onHit']; onImpact?: Weapon['onImpact']; onReloadStart?: (() => void) | undefined; onReloadEnd?: (() => void) | undefined; onDry?: (() => void) | undefined;
  /** a swap started (play the sling rustle) */
  onSwap?: ((to: WeaponId) => void) | undefined;
  /** a weapon was unlocked (the touch layer shows its SWAP pill) */
  onUnlock?: ((id: Equipment['id']) => void) | undefined;
  private unlocked = new Set<Equipment['id']>();
  private serverWire: WeaponWire | null = null;
  private _enabled = true;
  private _adsHeld = false;
  private _altHeld = false;
  private _visible = true;
  private _stowed = false; private stowT = 0;
  private order: WeaponId[] | undefined;
  private swapping: { from: Weapon; to: Weapon; t: number; switched: boolean } | null = null;
  private readonly pickups = new Map<string, EquipmentPickup>();
  private readonly preparations = new Map<Weapon, () => Promise<void>>();
  private selection: PendingSelection | undefined;
  private readonly reportedUpdates = new WeakSet<Equipment>();

  /** Place the active level's declarations using its installed equipment rows. */
  placePickups(loadout: PickupLoadout, host: EquipmentPickupHost): void {
    for (const declaration of loadout.pickups ?? []) {
      if (this.scope.disposed) throw new Error('Cannot place pickups on disposed equipment');
      if (this.pickups.has(declaration.id)) throw new Error(`Duplicate equipment pickup ${declaration.id}`);
      const weapon = this.list.find((item) => item.row.id === declaration.id);
      if (weapon === undefined) throw new Error(`Pickup equipment ${declaration.id} is not installed`);
      const row = weapon.row, spec = row.pickup;
      if (spec === undefined) throw new Error(`Equipment ${row.id} has no pickup factory`);
      const pickup = spec.create(declaration.at, spec.prompt);
      if (pickup === null) {
        // Saved ownership/harness selection never depended on a display site in the original shell.
        if (host.owned.has(spec.owned) || host.hold === row.id) { this.unlock(weapon.id); this.select(weapon.id, true); }
        continue;
      }
      this.pickups.set(row.id, pickup);
      host.prompts.push(pickup.interactable);
      const stop = this.scope.child(`pickup:${row.id}`);
      let live = true, granted = false;
      stop.onDispose(() => {
        live = false;
        pickup.onPickup = undefined; pickup.onNear = undefined;
        const at = host.prompts.indexOf(pickup.interactable);
        if (at !== -1) host.prompts.splice(at, 1);
        this.pickups.delete(row.id);
        pickup.dispose();
      });
      pickup.onNear = (inside) => { if (live) host.onNear(inside); };
      pickup.onPickup = () => {
        if (!live || granted) return;
        granted = true;
        this.interact(spec.owned); // the server judges a linked pickup by this name, and holds it or says otherwise
        host.owned.grant(spec.owned);
        this.unlock(weapon.id); this.select(weapon.id);
        host.onPickup(row, spec.toast);
      };
      // Build then hide, as the original saved/harness path did: retained pooled lights and RNG draws stay identical.
      if (host.owned.has(spec.owned) || host.hold === row.id) {
        granted = true;
        this.unlock(weapon.id); this.select(weapon.id, true);
        pickup.dispose();
      }
    }
  }

  pickup(id: string): EquipmentPickup | null { return this.pickups.get(id) ?? null; }
  updatePickups(dt: number, t: number): void { for (const pickup of this.pickups.values()) pickup.update(dt, t); }

  readonly tools: Tool[] = [];
  private readonly scope: Scope;
  private readonly input: EquipmentInput | undefined;
  readonly events: Events | undefined;
  constructor(first: Weapon, opts: { scope?: Scope; events?: Events; input?: EquipmentInput; order?: WeaponId[] } = {}) {
    this.scope = opts.scope?.child('equipment') ?? new Scope('equipment');
    this.input = opts.input;
    this.events = opts.events;
    this.list = []; this.current = first; this.order = opts.order;
    this.scope.onDispose(() => { this.preparations.clear(); });
    this.add(first, { locked: false });
    const input = opts.input;
    input?.bind('swap', () => this.swap(), this.scope);
    input?.bind('swap.next', () => this.step(1), this.scope);
    input?.bind('swap.prev', () => this.step(-1), this.scope);
    input?.bind('swap.ui', () => this.swap(), this.scope, () => this.enabled);
    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) input?.bind(`swap.slot.${digit}`, () => {
      const w = this.available[digit - 1]; if (w) this.select(w.id);
    }, this.scope);
  }
  private wire(w: Weapon): void {
    // Compatibility callbacks keep existing source clocks; each boundary publishes once for new subscribers.
    w.onFire = () => { this.events?.emit('weapon.fired', { id: w.row.id }); this.onFire?.(); };
    w.onHit = (kind, headshot, killed) => { this.events?.emit('weapon.hit', { id: w.row.id, kind, headshot, killed }); this.onHit?.(kind, headshot, killed); };
    w.onImpact = (surface, point) => { this.events?.emit('weapon.impact', { id: w.row.id, surface, point: point.clone() }); this.onImpact?.(surface, point); };
    w.onReloadStart = () => { this.events?.emit('weapon.reload', { id: w.row.id, phase: 'start' }); this.onReloadStart?.(); };
    w.onReloadEnd = () => { this.events?.emit('weapon.reload', { id: w.row.id, phase: 'end' }); this.onReloadEnd?.(); };
    w.onDry = () => { this.events?.emit('weapon.dry', { id: w.row.id }); this.onDry?.(); };
  }
  add(w: Weapon | Tool, opts: { locked: boolean; order?: number }): void {
    if ([...this.list, ...this.tools].some((item) => item.row.id === w.row.id)) throw new Error(`Duplicate equipment ${w.row.id}`);
    w.install({ scope: this.scope.child(w.row.id), ...(this.events === undefined ? {} : { events: this.events }) });
    if (w instanceof Tool) this.tools.push(w);
    else {
      this.input?.bind(`swap.weapon.${String(w.id)}`, () => { this.select(w.id); }, this.scope, () => this.enabled);
      this.wire(w); w.wire = this.serverWire;
      if (opts.order === undefined) this.list.push(w); else this.list.splice(opts.order, 0, w);
      w.setActive(w === this.current); this.apply();
    }
    if (!opts.locked) this.unlocked.add(w.id);
    this.apply();
  }
  replace(id: WeaponId, next: Weapon): void {
    const previous = this.get(id), index = this.list.indexOf(previous);
    if (next.id !== id) throw new Error(`Replacement must preserve legacy slot ${String(id)}`);
    next.state.ammo = previous.state.ammo;
    next.state.reserve = previous.state.reserve;
    next.state.loaded = previous.state.loaded;
    next.state.reloading = previous.state.reloading;
    next.state.reloadProgress = previous.state.reloadProgress;
    next.state.ads = previous.state.ads;
    next.holster = previous.holster;
    next.install({ scope: this.scope.child(next.row.id), ...(this.events === undefined ? {} : { events: this.events }) }); this.wire(next);
    this.list[index] = next;
    this.preparations.delete(previous);
    if (this.selection?.to === previous) { this.selection.supersede(); this.selection = undefined; }
    if (this.current === previous) this.current = next;
    if (this.swapping?.from === previous) this.swapping.from = next;
    if (this.swapping?.to === previous) this.swapping.to = next;
    previous.setActive(false); previous.dispose();
    next.setActive(next === this.current); next.model.visible = next === this.current && this._visible;
    this.apply(); this.onUnlock?.(id);
  }
  dispose(): void { this.scope.dispose(); }

  /** input on the held weapon (menu / pause → false) */
  get enabled(): boolean { return this._enabled; }
  set enabled(on: boolean) { this._enabled = on; this.apply(); }
  setEnabled(on: boolean): void { this.enabled = on; }
  /** the held weapon's viewmodel (hidden under the main menu) */
  get visible(): boolean { return this._visible; }
  set visible(on: boolean) { this._visible = on; this.current.model.visible = on; }
  /** the touch AIM latch — survives a swap (the incoming weapon comes up sighted) */
  get adsHeld(): boolean { return this._adsHeld; }
  set adsHeld(on: boolean) { this._adsHeld = on; this.apply(); }
  get swappingNow(): boolean { return this.swapping !== null; }
  /** lowered out of the frame, input off (a dialogue is open — E129); false raises it again */
  get stowed(): boolean { return this._stowed; }
  set stowed(on: boolean) { this._stowed = on; this.apply(); }
  /** The held secondary action is released during a swap. */
  get altHeld(): boolean { return this._altHeld; }
  set altHeld(on: boolean) { this._altHeld = on; this.apply(); }

  private apply(): void {
    for (const w of this.list) {
      const held = w === this.current && this.swapping === null;
      w.enabled = this._enabled && held && !this._stowed;
      w.adsHeld = held && this._adsHeld;
      w.altHeld = held && this._altHeld;
    }
    for (const tool of this.tools) tool.enabled = this._enabled && this.has(tool.id);
  }

  get(id: WeaponId): Weapon {
    const w = this.list.find((k) => k.id === id);
    if (w === undefined) throw new Error(`EquipmentService: no weapon '${String(id)}' in the kit`);
    return w;
  }
  /** Is this slot owned? */
  has(id: Equipment['id']): boolean { return this.unlocked.has(id); }
  /** the unlocked weapons, in kit order */
  get available(): Weapon[] {
    const list = this.list.filter((w) => this.unlocked.has(w.id));
    const order = this.order;
    if (order === undefined) return list;
    const rank = (id: WeaponId) => { const i = order.indexOf(id); return i === -1 ? order.length : i; };
    return list.sort((a, b) => rank(a.id) - rank(b.id));
  }
  private readonly compareAvailable = (a: Weapon, b: Weapon): number => {
    const order = this.order; if (order === undefined) return 0;
    const ai = order.indexOf(a.id), ar = ai === -1 ? order.length : ai;
    const bi = order.indexOf(b.id), br = bi === -1 ? order.length : bi;
    return ar - br;
  };
  /** Copy live unlocked weapons in the same order into a caller-owned array.
   * The ordinary available getter retains its independent-array contract. */
  availableInto(target: Weapon[]): Weapon[] {
    const list = this.list, count = list.length;
    if (target === list) throw new Error('Available equipment target must not be the installed list');
    let length = 0;
    for (let index = 0; index < count; index++) {
      if (!(index in list)) continue;
      const weapon = list[index]; if (weapon === undefined) throw new TypeError('Invalid installed weapon');
      if (this.unlocked.has(weapon.id)) target[length++] = weapon;
    }
    target.length = length;
    if (this.order !== undefined) target.sort(this.compareAvailable);
    return target;
  }
  unlock(id: Equipment['id']): void {
    if (this.unlocked.has(id) || !([...this.list, ...this.tools].some((w) => w.id === id))) return; // absent slots remain absent
    this.unlocked.add(id);
    this.apply();
    const item = [...this.list, ...this.tools].find((w) => w.id === id);
    if (item !== undefined) this.events?.emit('weapon.unlocked', { id: item.row.id });
    this.onUnlock?.(id);
  }
  /** what the player owned before the practice room lent the whole kit (null = no loan running) */
  private loaned: Set<Equipment['id']> | null = null;
  /** the practice room lends every weapon of the kit (E298 A, the weapon explorer); `endLoan` puts back what was owned */
  lendAll(): void {
    if (this.loaned !== null) return;
    this.loaned = new Set(this.unlocked);
    for (const w of [...this.list, ...this.tools]) this.unlock(w.id);
  }
  endLoan(): void {
    const owned = this.loaned;
    if (owned === null) return;
    this.loaned = null;
    this.unlocked = owned;
    if (this.selection !== undefined && !owned.has(this.selection.to.id)) { this.selection.supersede(); this.selection = undefined; }
    this.apply();
    const first = this.list.find((w) => owned.has(w.id));
    if (!owned.has(this.current.id) && first !== undefined) this.select(first.id, true);
    this.onUnlock?.(this.current.id); // the SWAP pill / the strip re-read what is owned
  }
  /** hold `id` (if unlocked); animated unless `instant` (start-up `?weapon=`) */
  select(id: WeaponId, instant = false): void {
    // FM4: a player's swap asked while the online link is down never starts, so a slow preparation can't send it after the link is back
    const wire = this.serverWire;
    if (!instant && wire !== null && 'mayEquip' in wire && wire.mayEquip !== undefined && !wire.mayEquip()) return;
    this.choose(id, instant);
  }
  /** `select` without the player's admission: the server's word on what is held always lands. */
  private choose(id: WeaponId, instant: boolean): void {
    if (!this.unlocked.has(id)) return;
    const to = this.get(id);
    const previous = this.selection;
    if (previous?.waiting === true && previous.to === to) { previous.instant ||= instant; return; }
    previous?.supersede();
    this.selection = undefined;
    if (to === this.current && this.swapping === null) return;
    const prepare = this.preparations.get(to);
    if (prepare === undefined) { this.commitSelection(to, instant); return; }
    let cancel: () => void = () => undefined;
    let supersede: () => void = () => undefined;
    const closed = new Promise<never>((_resolve, reject) => { cancel = () => { reject(new Error('Equipment preparation owner left')); }; });
    const redirected = new Promise<void>(resolve => { supersede = resolve; });
    const forget = this.scope.capture('disposers', cancel);
    const request:PendingSelection={to,instant,waiting:true,pending:Promise.resolve(),supersede};
    this.selection=request;
    const started = (async()=>{
      await Promise.resolve();
      if (this.scope.disposed || this.scope.disposing) throw new Error('Equipment preparation owner left');
      await this.scope.run(prepare);
      if (this.preparations.get(to) === prepare) this.preparations.delete(to);
    })();
    request.pending=this.finishSelection(request,started,closed,redirected,forget);
    void this.observeSelection(request);
  }
  private async finishSelection(request:PendingSelection,started:Promise<void>,closed:Promise<never>,redirected:Promise<void>,forget:()=>void):Promise<void>{
    const to=request.to;
    try{
      await Promise.race([started,closed,redirected]);
      if (this.scope.disposed || this.scope.disposing) throw new Error('Equipment preparation owner left');
      if (this.selection !== request || !this.list.includes(to) || !this.unlocked.has(to.id)) return;
      this.commitSelection(to, request.instant);
    }catch(error:unknown){
      if (!this.scope.disposed && !this.scope.disposing && (this.selection !== request || !this.list.includes(to) || !this.unlocked.has(to.id))) return;
      throw error;
    }finally{request.waiting=false;forget();}
  }
  private async observeSelection(request:PendingSelection):Promise<void>{
    try{await request.pending;}
    catch(error:unknown){
      if (!this.scope.disposed && !this.scope.disposing && this.selection === request) console.error('Equipment preparation failed', error);
    }
  }
  /** Register a native late-view preparation before exposing an inactive slot.
   * Profiles/ownership remain synchronous; selection keeps the current weapon
   * until this exact weapon's preparation succeeds. */
  prepareOnSelect(id: WeaponId, prepare: () => Promise<void>): void {
    if (this.scope.disposed || this.scope.disposing) throw new Error('Equipment preparation owner left');
    const weapon = this.get(id);
    if (weapon === this.current) throw new Error('Initial equipment must be prepared before publication');
    if (this.preparations.has(weapon)) throw new Error('Equipment preparation already registered');
    this.preparations.set(weapon, prepare);
  }
  /** Initial/restored selection is a readiness fence before controls. Redirects
   * join the latest request; a genuine failure or retirement still refuses. */
  async settleSelection(): Promise<void> {
    for (;;) {
      if (this.scope.disposed || this.scope.disposing) throw new Error('Equipment preparation owner left');
      const selection = this.selection;
      if (selection === undefined) return;
      await selection.pending;
      if (this.selection === selection) { this.selection = undefined; return; }
    }
  }
  private commitSelection(to: Weapon, instant: boolean): void {
    if (to === this.current && this.swapping === null) return;
    if (this.swapping !== null) { if (this.swapping.to === to) return; this.finishSwap(); if (to === this.current) return; }
    if (instant) {
      this.current.setActive(false); this.current.holster = 0;
      this.current = to; to.holster = 0; to.setActive(true); to.model.visible = this._visible;
      this.serverWire?.equip(to.row.id);
      this.apply();
      return;
    }
    this.swapping = { from: this.current, to, t: 0, switched: false };
    this.serverWire?.equip(to.row.id);
    this.apply();
    this.events?.emit('weapon.swap', { to: to.row.id });
    this.onSwap?.(to.id);
  }
  /** Select the next owned slot, if there is one. */
  swap(): void { this.step(1); }
  /** the owned weapon `dir` slots away from the held one, wrapping (the ring's tap, Q, the mouse wheel) */
  step(dir: 1 | -1): void {
    const list = this.available;
    if (list.length < 2) return;
    const i = list.indexOf(this.selection?.waiting === true ? this.selection.to : this.current);
    const next = list[(i + dir + list.length) % list.length];
    if (next !== undefined) this.select(next.id);
  }
  private finishSwap(): void {
    const s = this.swapping;
    if (s === null) return;
    s.from.holster = 0; s.to.holster = 0;
    if (!s.switched) { s.from.setActive(false); this.current = s.to; s.to.setActive(true); s.to.model.visible = this._visible; }
    this.swapping = null;
    this.apply();
  }

  tryFire(): void { this.current.tryFire(); }
  reload(): void { this.current.reload(); }
  aimRay(o: Vector3, d: Vector3): Vector3 { return this.current.aimRay(o, d); }
  get aimInfo(): AimInfo | null { return this.current.aimInfo; }
  get state(): WeaponState { return this.current.state; }
  /** the HELD weapon's melee reach (m from the eye), undefined while a ranged weapon is out — Combat's MISS judgement reads it per swing */
  get reach(): number | undefined { return this.current.reach; }

  /** Give every weapon its line to the server (P1-E5.3-E1). */
  bindWire(wire: WeaponWire | null): void { this.serverWire = wire; for (const w of this.list) w.wire = wire; wire?.equip(this.current.row.id); }
  /** A named interaction the server must judge: nothing, where no server owns the player. */
  interact(id: string): void { this.serverWire?.interact(id); }
  /** The server says this row is what the player holds (P1-E6): the page holds it too, owned or lent here or not. */
  heldByServer(row: string): void {
    const weapon = this.list.find(w => w.row.id === row);
    if (weapon === undefined) return;
    this.unlock(weapon.id); this.choose(weapon.id, false);
  }
  /** The server settled a blow of ours: the weapon in hand plays it. */
  serverHit(hit: OwnHit): void { this.current.serverHit(hit); }
  /** The server's arrow count, for every bow held: one in the hand or one on the back. */
  mirrorArrows(count: number): void { for (const weapon of this.list) weapon.mirrorArrows(count); }
  /** The server refused a start: the weapon in hand lets go. */
  attackRefused(): void { this.current.attackRefused(); }
  update(dt: number, t: number): void {
    const s = this.swapping;
    if (s !== null) {
      s.t += dt;
      if (s.t < SWAP_TIME) s.from.holster = s.t / SWAP_TIME;
      else {
        if (!s.switched) { s.switched = true; s.from.holster = 1; s.from.setActive(false); this.current = s.to; s.to.holster = 1; s.to.setActive(true); s.to.model.visible = this._visible; }
        s.to.holster = Math.max(0, 1 - (s.t - SWAP_TIME) / SWAP_TIME);
        if (s.t >= SWAP_TIME * 2) this.finishSwap();
      }
    }
    this.stowT = Math.min(1, Math.max(0, this.stowT + (this._stowed ? dt : -dt) / STOW_TIME));
    if (this.swapping === null) this.current.holster = this.stowT;
    for (const w of this.list) this.updateItem(w, dt, t);
    for (const tool of this.tools) if (this.has(tool.id)) this.updateItem(tool, dt, t);
    // Item presentation may animate visibility; the session's explicit hidden gate still wins at the border or menu.
    if (!this._visible) this.current.model.visible = false;
  }

  /** A bad observation skips this item for one frame; other items and later frames still run. */
  private updateItem(item: Equipment, dt: number, t: number): void {
    try { item.update(dt, t); }
    catch (error) {
      if (!this.reportedUpdates.has(item)) {
        this.reportedUpdates.add(item);
        emitFault({ system: `equipment.${item.row.id}`, error, verdict: 'uncaught' });
      }
    }
  }
}
