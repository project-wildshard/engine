import { ScriptWorld, type EffectRules, type EffectTransaction, type ScriptEffect, type ScriptEntity } from './effects';

/** Server-script state effects. Player writes always use the invoking entity's host-bound actor id. */
export const SCRIPT_STATE_OP: Readonly<{ shared: 5; player: 6; }> = Object.freeze({ shared: 5, player: 6 });
/** Numeric declared fields; bool uses 0/1. Strings are outside the numeric v0 script ABI. */
export interface ScriptStateField { id: number; name: string; type: 'bool' | 'i32' | 'f64'; privacy: 'public' | 'owner' | 'host'; default: number; min: number; max: number }
/** Shared fields belong to the host; player fields have one independent record per stable actor id. */
export interface ScriptStateDeclaration { shared: readonly ScriptStateField[]; player: readonly ScriptStateField[] }
/** A complete JSON-compatible state checkpoint, including quarantined entities and actor-scoped records. */
export interface ScriptWorldState { entities: readonly ScriptEntity[]; shared: readonly number[]; players: readonly { actorId: string; values: readonly number[] }[]; seats?: readonly ScriptSeat[] }
/** A player who joined after install: their record, and the entities they act through, the first being their body's. `content[i]` is the handle a script reads on `handles[i]`. */
export interface ScriptSeat { readonly actorId: string; readonly handles: readonly number[]; readonly content: readonly number[] }
function valid(field: ScriptStateField, value: number): boolean {
  return Number.isFinite(value) && value >= field.min && value <= field.max && (field.type === 'f64' || Number.isInteger(value))
    && (field.type !== 'bool' || value === 0 || value === 1) && (field.type !== 'i32' || value >= -2147483648 && value <= 2147483647);
}
const NO_EFFECTS: readonly ScriptEffect[] = Object.freeze([]);
/** Numeric effect world extended with declared shared and actor-scoped state, committed as one batch. */
export class DeclaredScriptWorld extends ScriptWorld {
  readonly declaration: ScriptStateDeclaration;
  private shared: number[];
  private players = new Map<string, number[]>();
  private declaredRevision = 0;
  private declaredContent = 0;
  private readonly views = new Map<string, { shared: Record<string, number>; player: Record<string, number> }>();
  private readonly actors: Map<number, string>;
  private seats = new Map<string, ScriptSeat>();
  private readonly contentHandles = new Map<number, number>();
  private readonly defaults: readonly number[];
  constructor(rules: EffectRules, entities: readonly ScriptEntity[], declaration: ScriptStateDeclaration, actors: ReadonlyMap<number, string>) {
    super(rules, entities);
    if (declaration.shared.length + declaration.player.length > 24) throw new Error('Script state input capacity');
    for (const fields of [declaration.shared, declaration.player]) {
      if (new Set(fields.map((f) => f.id)).size !== fields.length || new Set(fields.map((f) => f.name)).size !== fields.length
        || fields.some((f) => !Number.isSafeInteger(f.id) || f.id < 1 || f.id > 0x7fffffff || !/^[a-z][a-z0-9.-]*$/u.test(f.name)
          || !Number.isFinite(f.min) || !Number.isFinite(f.max) || f.min > f.max || !valid(f, f.default))) throw new Error('Invalid state declaration');
    }
    this.declaration = { shared: declaration.shared.map((f) => Object.freeze({ ...f })).sort((a, b) => a.id - b.id), player: declaration.player.map((f) => Object.freeze({ ...f })).sort((a, b) => a.id - b.id) };
    this.actors = new Map(actors); this.shared = this.declaration.shared.map((f) => f.default); this.defaults = Object.freeze(this.declaration.player.map((f) => f.default));
    for (const [entity, actorId] of actors) {
      if (!this.entity(entity) || actorId.length === 0 || actorId.length > 128) throw new Error('Invalid actor binding');
      if (!this.players.has(actorId)) this.players.set(actorId, this.declaration.player.map((f) => f.default));
    }
  }
  /** Host-derived actor provenance; scripts never provide or replace it. */
  override actor(handle: number): string | undefined { return this.actors.get(handle); }
  /** This player's seat, if they have one. */
  seatOf(actorId: string): readonly number[] | undefined { return this.seats.get(actorId)?.handles; }
  override contentHandle(handle: number): number { return this.contentHandles.get(handle) ?? handle; }
  /** Who has a seat, in stable actor order. */
  seatedActors(): readonly string[] { return [...this.seats.keys()].sort(); }
  /** True when this world keeps the actor's record, so a seat for the same kind of actor belongs here. */
  holds(actorId: string): boolean { return this.players.has(actorId); }
  /** A player joins between steps: their entities, bound to them, and a record at the declared defaults. `content[i]` is the handle a script reads on `entities[i]`. */
  seat(actorId: string, entities: readonly ScriptEntity[], content: readonly number[]): void {
    if (entities.length === 0 || entities.length !== content.length || actorId.length === 0 || actorId.length > 128 || this.players.has(actorId)) throw new Error('Invalid actor seat');
    this.admit(entities);
    const seat = { actorId, handles: entities.map(entity => entity.id), content: [...content] };
    this.sit(seat); this.players = new Map(this.players).set(actorId, [...this.defaults]);
    this.declaredRevision++; this.declaredContent++;
  }
  private sit(seat: ScriptSeat): void {
    this.seats.set(seat.actorId, seat);
    seat.handles.forEach((handle, index) => { this.actors.set(handle, seat.actorId); this.contentHandles.set(handle, seat.content[index] ?? handle); });
  }
  /** A player leaves with their entities and record. Returns the entities they held. */
  unseat(actorId: string): readonly number[] {
    const handles = this.seats.get(actorId)?.handles;
    if (handles === undefined) throw new Error('Unknown actor seat');
    this.dismiss(handles);
    for (const handle of handles) { this.actors.delete(handle); this.contentHandles.delete(handle); }
    this.seats.delete(actorId); this.views.delete(actorId);
    const players = new Map(this.players); players.delete(actorId); this.players = players;
    this.declaredRevision++; this.declaredContent++;
    return handles;
  }
  /** Trusted server input in declaration order, never another actor's private record. */
  input(handle: number): readonly number[] { const out: number[] = []; this.appendInput(handle, out); return out; }
  /** `input(handle)` appended to a caller's row (the lane's ABI input), without an intermediate copy. */
  appendInput(handle: number, out: number[]): void {
    const actor = this.actor(handle), values = actor === undefined ? this.defaults : this.players.get(actor);
    if (!values) throw new Error('Missing actor state');
    out.push(this.shared.length, values.length);
    for (let i = 0; i < this.shared.length; i++) out.push(this.shared[i] ?? 0);
    for (let i = 0; i < values.length; i++) out.push(values[i] ?? 0);
  }
  /** A public/owner view; host-only fields are never projected to a player. Returned records are copies. */
  view(actorId: string): { shared: Readonly<Record<string, number>>; player: Readonly<Record<string, number>> } {
    const cached = this.projection(actorId);
    // Callers still own detached records; privacy projection is only rebuilt
    // after a declared-state commit, never with Object.fromEntries per tick.
    return { shared: { ...cached.shared }, player: { ...cached.player } };
  }
  /** `view(actorId)[scope][name]`, read from the cached projection without copying its records. */
  viewField(actorId: string, scope: 'shared' | 'player', name: string): number | undefined { return this.projection(actorId)[scope][name]; }
  /** A public shared field, which reads the same for every player. */
  publicField(name: string): number | undefined {
    const index = this.declaration.shared.findIndex(field => field.name === name);
    return this.declaration.shared[index]?.privacy === 'public' ? this.shared[index] : undefined;
  }
  /** Every public shared field: what any player may see, so what a room sends. */
  publicShared(): readonly { readonly name: string; readonly value: number }[] {
    return this.declaration.shared.flatMap((field, index) => field.privacy === 'public' ? [{ name: field.name, value: this.shared[index] ?? field.default }] : []);
  }
  private projection(actorId: string): { shared: Record<string, number>; player: Record<string, number> } {
    const values = this.players.get(actorId);
    if (!values) throw new Error('Unknown actor');
    let cached = this.views.get(actorId);
    if (cached === undefined) {
      const shared: Record<string, number> = {}, player: Record<string, number> = {};
      for (let i = 0; i < this.declaration.shared.length; i++) { const field = this.declaration.shared[i]; if (field?.privacy === 'public') shared[field.name] = this.shared[i] ?? field.default; }
      for (let i = 0; i < this.declaration.player.length; i++) { const field = this.declaration.player[i]; if (field !== undefined && field.privacy !== 'host') player[field.name] = values[i] ?? field.default; }
      cached = { shared, player }; this.views.set(actorId, cached);
    }
    return cached;
  }
  /** Complete checkpoint ordered by stable actor id, independent of map insertion order. */
  checkpoint(): ScriptWorldState {
    const state = { entities: this.state(), shared: [...this.shared], players: [...this.players].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([actorId, values]) => ({ actorId, values: [...values] })) };
    return this.seats.size === 0 ? state : { ...state, seats: this.seatedActors().flatMap(actorId => { const seat = this.seats.get(actorId); return seat === undefined ? [] : [{ actorId, handles: [...seat.handles], content: [...seat.content] }]; }) };
  }
  /** Restore only matching actors and declared, typed field values. A save's seats replace whoever sits now. */
  restoreState(saved: ScriptWorldState): void {
    const check = (fields: readonly ScriptStateField[], values: readonly number[]): boolean => fields.length === values.length && fields.every((f, i) => valid(f, values[i] ?? Number.NaN));
    const seats = saved.seats ?? [], owned = new Set([...this.seats.values()].flatMap(seat => seat.handles)), founders = new Set([...this.actors].flatMap(([handle, actor]) => owned.has(handle) ? [] : [actor]));
    const fixed = [...this.actors.keys()].filter(handle => !owned.has(handle)), expected = new Set([...this.players.keys()].filter(actor => !this.seats.has(actor)).concat(seats.map(seat => seat.actorId)));
    const handles = seats.flatMap(seat => seat.handles);
    if (!check(this.declaration.shared, saved.shared) || saved.players.length !== expected.size || new Set(saved.players.map((p) => p.actorId)).size !== saved.players.length
      || saved.players.some((p) => !expected.has(p.actorId) || !check(this.declaration.player, p.values)) || [...fixed, ...handles].some((handle) => !saved.entities.some((e) => e.id === handle))
      || new Set(handles).size !== handles.length || handles.some(handle => this.actors.has(handle) && !owned.has(handle)) || seats.some(seat => seat.handles.length === 0 || seat.handles.length !== seat.content.length || founders.has(seat.actorId))
      || new Set(seats.map(seat => seat.actorId)).size !== seats.length) throw new Error('Invalid declared-state snapshot');
    super.restore(saved.entities, handles.length);
    for (const handle of owned) { this.actors.delete(handle); this.contentHandles.delete(handle); }
    this.seats = new Map();
    for (const seat of seats) this.sit({ actorId: seat.actorId, handles: [...seat.handles], content: [...seat.content] });
    this.shared = [...saved.shared]; this.players = new Map(saved.players.map((p) => [p.actorId, [...p.values]])); this.declaredRevision++; this.declaredContent++; this.views.clear();
  }
  /** Entity content plus declared shared/player values; a commit that rewrote nothing keeps it. */
  override get contentRevision(): number { return super.contentRevision + this.declaredContent; }
  override prepare(effects: readonly ScriptEffect[], self: number, spawnAllowance: number, eventAllowance: number): EffectTransaction {
    const before = this.declaredRevision, actorId = this.actor(self);
    let shared = this.shared, players = this.players, ordinary: ScriptEffect[] | undefined, split = false;
    for (let at = 0; at < effects.length; at++) {
      const effect = effects[at]; if (effect === undefined) continue;
      if (effect.op !== SCRIPT_STATE_OP.shared && effect.op !== SCRIPT_STATE_OP.player) { if (split) (ordinary ??= []).push(effect); continue; }
      // The first state effect splits off the ordinary ones before it (all of them); a call with none passes its list
      // through, and one with only state effects passes an empty list.
      if (!split) { split = true; if (at > 0) ordinary = effects.slice(0, at); }
      if (!Number.isFinite(effect.a) || !Number.isFinite(effect.b) || !Number.isFinite(effect.c) || !Number.isFinite(effect.d) || effect.c !== 0 || effect.d !== 0) throw new Error('Invalid state effect');
      const isShared = effect.op === SCRIPT_STATE_OP.shared, fields = isShared ? this.declaration.shared : this.declaration.player;
      let index = -1; for (let i = 0; i < fields.length; i++) if (fields[i]?.id === effect.a) { index = i; break; }
      const field = fields[index];
      if (!field || !valid(field, effect.b)) throw new Error('Undeclared or invalid state field');
      if (isShared) { if (!Object.is(shared[index], effect.b)) { if (shared === this.shared) shared = shared.slice(); shared[index] = effect.b; } }
      else {
        if (actorId === undefined) throw new Error('Player effect requires an actor');
        let values = players.get(actorId);
        if (values === undefined) throw new Error('Missing actor state');
        // Rewriting a field's current value leaves the published records (and the cached views) shared.
        if (Object.is(values[index], effect.b)) continue;
        if (players === this.players) players = new Map(players);
        if (values === this.players.get(actorId)) { values = [...values]; players.set(actorId, values); }
        values[index] = effect.b;
      }
    }
    const tx = super.prepare(split ? ordinary ?? NO_EFFECTS : effects, self, spawnAllowance, eventAllowance);
    return { spawns: tx.spawns, events: tx.events, commit: () => {
      if (this.declaredRevision !== before) throw new Error('Stale declared-state transaction');
      tx.commit();
      if (this.shared !== shared || this.players !== players) { this.views.clear(); this.declaredContent++; }
      this.shared = shared; this.players = players; this.declaredRevision++;
    } };
  }
}
