/** V0 numeric effect operations; all records contain [op,a,b,c,d] f64 values. */
export const SCRIPT_OP: Readonly<{ field: 1; spawn: 2; event: 3; position: 4; }> = Object.freeze({ field: 1, spawn: 2, event: 3, position: 4 });
/** An effect request, decoded completely before the world changes. */
export interface ScriptEffect { op: number; a: number; b: number; c: number; d: number }
/** A host-owned entity; callers receive copies of its numeric state. */
export interface ScriptEntity { id: number; name: string; position: readonly [number, number, number]; fields: Readonly<Record<number, number>>; frozen: boolean; interactive: boolean }
/** A queued event delivered on a subsequent tick, never recursively during effect application. */
export interface ScriptEvent { type: number; target: number; value: number }
/** Content supplies legal field ranges, archetypes and event ids as data. */
export interface EffectRules { fields: Readonly<Record<number, readonly [number, number]>>; archetypes: readonly number[]; events: readonly number[]; maxEntities: number }
/** Complete transaction result; publication is a single host-owned state replacement. */
export interface EffectTransaction { commit: () => void; spawns: number; events: readonly ScriptEvent[] }
const coord = (n: number): boolean => Number.isFinite(n) && n >= -250 && n <= 250;
const id = (n: number): boolean => Number.isSafeInteger(n) && n > 0 && n <= 0x7fffffff;
function copy(e: ScriptEntity): ScriptEntity { return { ...e, position: [...e.position], fields: { ...e.fields } }; }
const NO_EVENTS: readonly ScriptEvent[] = Object.freeze([]);
/** Owns numeric state so batches either replace all affected entities or change none. */
export class ScriptWorld {
  private entities = new Map<number, ScriptEntity>();
  private next = 1;
  private revision = 0;
  private content = 0;
  private seatedEntities = 0;
  private readonly rules: EffectRules;
  /** @param seated how many of `entities` the host seated for its players, which content's allowance does not count. */
  constructor(rules: EffectRules, entities: readonly ScriptEntity[], seated = 0) {
    if (!Number.isSafeInteger(rules.maxEntities) || rules.maxEntities < 1 || rules.maxEntities > 10000 || !Number.isSafeInteger(seated) || seated < 0 || entities.length > rules.maxEntities + seated) throw new Error('Entity cap');
    for (const [key, range] of Object.entries(rules.fields)) if (!id(Number(key)) || !range.every(Number.isFinite) || range[0] > range[1]) throw new Error('Invalid field declaration');
    for (const ids of [rules.archetypes, rules.events]) if (ids.length > 1024 || ids.some((n) => !id(n)) || new Set(ids).size !== ids.length) throw new Error('Invalid effect declarations');
    this.rules = { ...rules, fields: Object.fromEntries(Object.entries(rules.fields).map(([k, v]) => [k, [...v]])), archetypes: [...rules.archetypes], events: [...rules.events] };
    for (const e of entities) {
      if (!id(e.id) || this.entities.has(e.id) || !e.position.every(coord)) throw new Error('Invalid entity');
      for (const [key, value] of Object.entries(e.fields)) this.field(Number(key), value);
      this.entities.set(e.id, copy(e)); this.next = Math.max(this.next, e.id + 1);
    }
    this.seatedEntities = seated;
  }
  /** Read-only copy, including the frozen/noninteractive quarantine state. */
  entity(handle: number): ScriptEntity | undefined { const e = this.entities.get(handle); return e ? copy(e) : undefined; }
  /** Allocation-free host admission; public entity() still returns a detached copy. */
  callable(handle: number): boolean { const entity = this.entities.get(handle); return entity !== undefined && !entity.frozen; }
  /** Host-bound actor provenance for an entity; ordinary numeric/mover worlds grant no item owner. */
  actor(_handle: number): string | undefined { return undefined; }
  /** The handle a script reads for this entity: a seated player's stands in for the one content declared. */
  contentHandle(handle: number): number { return handle; }
  /** Snapshot of host-owned entity state, ordered by numeric handle. */
  state(): readonly ScriptEntity[] { return [...this.entities.values()].sort((a, b) => a.id - b.id).map(copy); }
  /** How many entities the host seated for its players; content's allowance leaves them out. */
  get seated(): number { return this.seatedEntities; }
  /** Restore validated host-owned state without publishing a partially checked entity list. */
  restore(entities: readonly ScriptEntity[], seated = 0): void {
    const checked = new ScriptWorld(this.rules, entities, seated);
    this.entities = checked.entities; this.next = checked.next; this.seatedEntities = seated; this.revision++; this.content++;
  }
  /** A joining player's entities, between steps: never content's, so a full room leaves a script's spawns as they were. */
  protected admit(entities: readonly ScriptEntity[]): void {
    const checked = new ScriptWorld({ ...this.rules, maxEntities: 1 }, entities, entities.length);
    for (const entity of checked.entities.values()) if (this.entities.has(entity.id)) throw new Error('Invalid entity');
    const next = new Map(this.entities);
    for (const entity of checked.entities.values()) next.set(entity.id, entity);
    this.entities = next; this.next = Math.max(this.next, checked.next); this.seatedEntities += entities.length; this.revision++; this.content++;
  }
  /** A leaving player's entities. Handles run on from the greatest left, as after a restore. */
  protected dismiss(handles: readonly number[]): void {
    const next = new Map(this.entities);
    for (const handle of handles) next.delete(handle);
    this.entities = next; this.next = Math.max(1, ...next.keys()) + (next.size === 0 ? 0 : 1); this.seatedEntities -= handles.length; this.revision++; this.content++;
  }
  /** Quarantine or explicitly resume an entity after a failed script call. */
  freeze(handle: number, frozen: boolean): void { const e = this.entities.get(handle); if (e) { this.entities.set(handle, { ...e, frozen, interactive: !frozen }); this.revision++; this.content++; } }
  /** Advances only when entity state changes (a commit that wrote something, a freeze or a restore); a commit of
   * no-op effects keeps it, unlike the transaction fence. */
  get contentRevision(): number { return this.content; }
  private field(key: number, value: number): void {
    const range = this.rules.fields[key];
    if (!Number.isSafeInteger(key) || !range || !Number.isFinite(value) || value < range[0] || value > range[1]) throw new Error('Field id/value outside declared range');
  }
  /** Validate every effect and build a private next state; queued events cannot invoke another script here. */
  prepare(effects: readonly ScriptEffect[], self: number, spawnAllowance: number, eventAllowance: number): EffectTransaction {
    const before = this.entities, revision = this.revision;
    let next = before, nextId = this.next, spawns = 0, events: ScriptEvent[] | undefined;
    if (!before.has(self)) throw new Error('Unknown entity');
    for (let at = 0; at < effects.length; at++) {
      const effect = effects[at]; if (effect === undefined) continue;
      const { op, a, b, c, d } = effect;
      if (!Number.isFinite(op) || !Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) throw new Error('Non-finite effect');
      const entity = next.get(self); if (!entity) throw new Error('Unknown entity');
      if (op === SCRIPT_OP.field) {
        this.field(a, b); if (c !== 0 || d !== 0) throw new Error('Reserved effect values');
        // Rewriting a field's current value keeps the entity record (and the map) shared.
        if (!Object.is(entity.fields[a], b)) (next === before ? (next = new Map(before)) : next).set(self, { ...entity, fields: { ...entity.fields, [a]: b } });
      } else if (op === SCRIPT_OP.position) {
        if (![a, b, c].every(coord) || d !== 0) throw new Error('Position outside bounds');
        if (!Object.is(entity.position[0], a) || !Object.is(entity.position[1], b) || !Object.is(entity.position[2], c)) (next === before ? (next = new Map(before)) : next).set(self, { ...entity, position: [a, b, c] });
      } else if (op === SCRIPT_OP.spawn) {
        if (!id(a) || !this.rules.archetypes.includes(a) || ![b, c, d].every(coord)) throw new Error('Spawn outside declared range');
        if (++spawns > spawnAllowance || next.size >= this.rules.maxEntities + this.seatedEntities || !id(nextId)) throw new Error('Spawn allowance');
        (next === before ? (next = new Map(before)) : next).set(nextId, { id: nextId, name: `entity ${nextId}`, position: [b, c, d], fields: {}, frozen: false, interactive: true }); nextId++;
      } else if (op === SCRIPT_OP.event) {
        if (!id(a) || !this.rules.events.includes(a) || !next.has(b) || d !== 0) throw new Error('Event outside declared range');
        events ??= [];
        if (events.length >= eventAllowance) throw new Error('Event allowance'); events.push({ type: a, target: b, value: c });
      } else throw new Error('Unknown effect operation');
    }
    return { spawns, events: events ?? NO_EVENTS, commit: () => {
      if (this.revision !== revision) throw new Error('Stale effect transaction');
      if (next !== this.entities || nextId !== this.next) this.content++;
      this.entities = next; this.next = nextId; this.revision++;
    } };
  }
}
