import { emitFault } from '@wildshard/engine/core/faults';
import type { SimHost } from '@wildshard/engine/sim';
import { parseWeatherProgram, parseWeatherReactions, type WeatherProgram, type WeatherReactionRows, type WeatherWorldSchema } from '@wildshard/format/weatherProgram';
import { TreeGrid } from '@wildshard/engine/world/forest/placement';
import type { WeatherHUD } from '@wildshard/engine/ui/HUD';
import type { Scope } from '@wildshard/engine/app/scope';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { weatherHud, weatherHudKey } from '../../../shared/game/weather/feed';
import * as v from 'valibot';
import type { WeatherContinuation } from '@wildshard/engine/world/weatherContinuation';

const ReactionsSaved = v.strictObject({ version: v.literal(1), weather: v.unknown(), registers: v.record(v.string(), v.pipe(v.number(), v.finite())),
  elapsed: v.pipe(v.number(), v.finite(), v.minValue(0)), kept: v.exactOptional(v.record(v.string(), v.record(v.string(), v.pipe(v.number(), v.finite())))) });
/** Fields of one reaction event, reused per event id (copy what you keep). */
export type WeatherReactionEvent = Readonly<Record<string, number>>;
/** One more player under the same sky: their numbers for the rows, and what they hear of their own. */
export interface WeatherListener {
  readonly id: string;
  /** write this player's `px py pz crouched mounted` (and any other `input.*` of theirs) over `inputs` */
  read: (inputs: Record<string, number>) => void;
  hear: (event: WeatherReactionEvent) => void;
}
/** The players a sky has besides the one its `inputs` describe, and the event each hears for themselves. */
export interface WeatherAudience { readonly event: string; readonly others: () => Iterable<WeatherListener> }
const LISTENER_INPUTS = ['px', 'py', 'pz', 'crouched', 'mounted', 'sheltered'] as const;
/**
 * A weather continuation's reactions (G474; rows `WeatherReactionRows`): its decisions at the rows' cadence through one
 * admitted return program, its events to subscribers and its whole continuation (the phase loop, its stream and every
 * register) as one plain snapshot. Page and renderer-free hosts drive the same rows; callers supply only numbers
 * (`inputs`: the player's `px py pz` and anything a step observes as `input.*`) and receive only numbered events.
 */
export class WeatherReactions {
  /** the caller's numbers for this frame, read by `input.*` sources (`sheltered` is the rows' shelter at `px pz`, or `covered`) */
  readonly inputs: Record<string, number> = { px: 0, py: 0, pz: 0, covered: 0, sheltered: 0 };
  private elapsed = 0;
  private readonly grid = new TreeGrid<{ x: number; z: number; r: number; top: number; index: number }>();
  private readonly listeners = new Map<string, ((event: WeatherReactionEvent) => void)[]>();
  private readonly events = new Map<string, Record<string, number>>();
  private reported: Set<'clock' | 'event' | 'field'> | undefined;
  /** Who else this sky falls on (`serve`). */
  private audience: WeatherAudience | undefined;
  /** What each player keeps for themselves: every register of the step behind the HUD's GET LOW (rows `hud.low`). */
  private readonly own: readonly string[];
  /** Every listener's own registers, by id; `weather.registers` holds those of the player `inputs` describes. */
  private readonly kept = new Map<string, Record<string, number>>();
  private reject(kind: 'clock' | 'event' | 'field', message: string): void {
    const reported = this.reported ??= new Set();
    if (reported.has(kind)) return;
    reported.add(kind); emitFault({system: 'weather.reactions', error: new Error(message), verdict: 'retry'});
  }
  constructor(readonly weather: WeatherContinuation, readonly rows: WeatherReactionRows, private readonly program: ReturnProgram) {
    const low = rows.hud?.low;
    this.own = rows.steps.find(step => step.write.some(([, target]) => target.slice(9) === low))?.write.map(([, target]) => target.slice(9)) ?? [];
    rows.points.forEach(([x, z, top], index) => { this.grid.add({ x, z, r: 0, top, index }); });
    for (const emit of rows.steps.flatMap(step => step.emit)) {
      const event = this.events.get(emit.event) ?? { age: 1e6 }; this.events.set(emit.event, event);
      for (const [field] of emit.fields) event[field] = 0;
    }
  }
  /** a state the rows call active (a storm is on) */
  get stormActive(): boolean { return this.rows.active.includes(this.weather.state); }
  get flash(): number { return this.weather.registers[this.rows.flash] ?? 0; }
  set flash(value: number) { this.weather.registers[this.rows.flash] = value; }
  register(name: string): number { return this.weather.registers[name] ?? 0; }
  /** An event's last fields and its `age` (seconds since it was raised; 1e6 before the first), for presentation rows. */
  record(event: string): WeatherReactionEvent { const record = this.events.get(event); if (record === undefined) throw new Error(`Undeclared weather reaction: ${event}`); return record; }
  /** Raise a declared event from outside the rows (a scripted bolt): its record and its subscribers, as a step would.
   * Bad runtime events/fields report once and leave the complete record untouched. */
  raise(event: string, fields: Readonly<Record<string, number>>): void {
    const record = this.events.get(event); if (record === undefined) {this.reject('event', `Undeclared weather reaction: ${event}`); return;}
    const entries = Object.entries(fields), invalid = entries.find(([field, value]) => !Object.hasOwn(record, field) || field === 'age' || !Number.isFinite(value));
    if (invalid !== undefined) {this.reject('field', `Invalid weather reaction field: ${invalid[0]}`); return;}
    for (const [field, value] of entries) record[field] = value;
    record['age'] = 0; for (const fn of (this.listeners.get(event)?.slice()??[])) fn(record);
  }
  /** Serve more than the player `inputs` describes: a step that emits `audience.event` then runs again for each other
   * listener on their numbers, writes nothing, draws nothing and raises nothing else: one bolt, each player's own hurt. */
  serve(audience: WeatherAudience): void { this.audience = audience; }
  private hudKey = '';
  /** The HUD's chip and GET LOW (rows `hud`) when they changed since the last call, else null; `quiet` holds GET LOW off. */
  hud(wind: number, quiet: boolean): WeatherHUD | null {
    const rows = this.rows.hud; if (rows === undefined) return null;
    const detail = weatherHud(rows, this.weather, wind, this.register(rows.low) === 1 && !quiet), key = weatherHudKey(detail);
    if (key === this.hudKey) return null;
    this.hudKey = key; return detail;
  }
  on(event: string, fn: (event: WeatherReactionEvent) => void): () => void {
    const list=this.listeners.get(event)??[];list.push(fn);this.listeners.set(event,list);let active=true;
    return ()=>{if(!active)return;active=false;const index=list.indexOf(fn);if(index!==-1)list.splice(index,1);if(list.length===0&&this.listeners.get(event)===list)this.listeners.delete(event);};
  }
  /** One frame: the phase loop, then (at the rows' cadence) the actions and the steps in order. True on a decision tick. */
  update(dt: number): boolean {
    if (!Number.isFinite(dt)) {this.reject('clock', 'Invalid weather reaction clock'); return false;}
    if (dt <= 0) return false;
    this.weather.update(dt); this.elapsed += dt;
    for (const record of this.events.values()) record['age'] = Math.min(1e6, (record['age'] ?? 0) + dt);
    if (this.elapsed + 1e-9 < 1 / this.rows.hz) return false;
    const step = this.elapsed, { actions } = this.rows;
    this.elapsed = 0;
    this.shelter();
    if (actions !== undefined && !(actions.unless !== undefined && this.register(actions.unless) !== 0)) this.weather.applyActions(actions.event, step);
    for (const row of this.rows.steps) if (row.when === undefined || this.read(row.when, step, {}) !== 0) this.run(row, step);
    return true;
  }
  /** `sheltered` for the player `inputs` describes this moment. */
  private shelter(): void {
    const { shelter } = this.rows, x = this.inputs['px'] ?? 0, z = this.inputs['pz'] ?? 0;
    this.inputs['sheltered'] = Number((this.inputs['covered'] ?? 0) > 0 || shelter.circles.some(([cx, cz, r]) => (cx - x) ** 2 + (cz - z) ** 2 < (r + shelter.margin) ** 2));
  }
  private read(ref: string | number, dt: number, output: Readonly<Record<string, number>>): number {
    if (typeof ref === 'number') return ref;
    const [kind, key = ''] = ref.split('.'), w = this.weather;
    const value = kind === 'dt' ? dt : kind === 'phaseT' ? w.phaseT : kind === 'phaseLen' ? w.phaseLen : kind === 'state' ? Number(w.state === key)
      : kind === 'register' ? w.registers[key] : kind === 'input' ? this.inputs[key] : output[key];
    if (value === undefined || !Number.isFinite(value)) throw new Error(`Missing weather reaction source: ${ref}`);
    return value;
  }
  private project(row: WeatherReactionRows['steps'][number], dt: number, random: boolean): Readonly<Record<string, number>> {
    const observed = Object.fromEntries(row.observe.map(([field, ref]) => [field, this.read(ref, dt, {})]));
    const probe = row.probe, candidates: Record<string, number>[] = [];
    if (probe !== undefined) {
      const x = this.read(probe.x, dt, {}), z = this.read(probe.z, dt, {}), r = this.read(probe.radius, dt, {});
      for (const t of this.grid.nearby(x, z, r)) if ((t.x - x) ** 2 + (t.z - z) ** 2 <= r * r) candidates.push({ x: t.x, z: t.z, top: t.top, index: t.index });
      candidates.sort((a, b) => ((a['x'] ?? 0) - x) ** 2 + ((a['z'] ?? 0) - z) ** 2 - (((b['x'] ?? 0) - x) ** 2 + ((b['z'] ?? 0) - z) ** 2) || (a['index'] ?? 0) - (b['index'] ?? 0));
      candidates.length = Math.min(candidates.length, 8); observed['count'] = candidates.length;
    }
    return this.program.project(row.signal, observed, random ? this.weather.random : undefined, candidates);
  }
  private run(row: WeatherReactionRows['steps'][number], dt: number): void {
    const output = this.project(row, dt, row.random);
    for (const [channel, target] of row.write) {
      const value = output[channel]; if (value === undefined) continue;
      if (target === 'phaseT') this.weather.phaseT = value; else this.weather.registers[target.slice(9)] = value;
    }
    for (const emit of row.emit) {
      if (output[emit.when] === undefined) continue;
      const event = this.events.get(emit.event); if (event === undefined) {this.reject('event', `Undeclared weather reaction: ${emit.event}`); continue;}
      for (const [field, ref] of emit.fields) event[field] = this.read(ref, dt, output);
      event['age'] = 0; for (const fn of (this.listeners.get(emit.event)?.slice()??[])) fn(event);
    }
    this.reachOthers(row, dt);
  }
  /** The same step again for each other listener, on their numbers. `inputs` ends as it began. */
  private reachOthers(row: WeatherReactionRows['steps'][number], dt: number): void {
    const audience = this.audience, mine = this.own;
    const keeps = row.write.some(([, target]) => mine.includes(target.slice(9)));
    if (audience === undefined || row.random || !keeps && !row.emit.some(emit => emit.event === audience.event)) return;
    const inputs = this.inputs, own = LISTENER_INPUTS.map(name => inputs[name] ?? 0), registers = this.weather.registers;
    const stood = mine.map(name => registers[name] ?? 0), present = new Set<string>();
    for (const listener of audience.others()) {
      listener.read(inputs); this.shelter(); present.add(listener.id);
      const kept = this.kept.get(listener.id);
      if (keeps) mine.forEach(name => { registers[name] = kept?.[name] ?? 0; });
      const output = this.project(row, dt, false);
      if (keeps) {
        const after: Record<string, number> = {};
        for (const name of mine) {
          const channel = row.write.find(([, target]) => target.slice(9) === name)?.[0];
          after[name] = (channel === undefined ? undefined : output[channel]) ?? registers[name] ?? 0;
        }
        this.kept.set(listener.id, after);
      }
      for (const emit of row.emit) {
        if (emit.event !== audience.event || output[emit.when] === undefined) continue;
        listener.hear(Object.fromEntries(emit.fields.map(([field, ref]) => [field, this.read(ref, dt, output)])));
      }
    }
    LISTENER_INPUTS.forEach((name, index) => { inputs[name] = own[index] ?? 0; });
    if (keeps) {
      mine.forEach((name, index) => { registers[name] = stood[index] ?? 0; });
      for (const id of this.kept.keys()) if (!present.has(id)) this.kept.delete(id);
    }
  }
  /** The sky turns from one player to another: `from`'s own registers go aside and `to`'s come up. */
  pass(from: string, to: string): void {
    const mine = this.own, registers = this.weather.registers, kept = this.kept.get(to), left: Record<string, number> = {};
    for (const name of mine) { left[name] = registers[name] ?? 0; registers[name] = kept?.[name] ?? 0; }
    this.kept.delete(to); this.kept.set(from, left);
  }
  /** A register a player keeps: `current` is whose stand in `weather.registers`. */
  ownRegister(player: string, current: string, name: string): number {
    return (player === current ? this.weather.registers[name] : this.kept.get(player)?.[name]) ?? 0;
  }
  /** The whole continuation as plain values. */
  snapshot(): { version: 1; weather: ReturnType<WeatherContinuation['captureWeather']>; registers: Record<string, number>; elapsed: number; kept?: Record<string, Record<string, number>> } { return { version: 1, weather: this.weather.captureWeather(), registers: { ...this.weather.registers }, elapsed: this.elapsed,
    ...(this.kept.size === 0 ? {} : { kept: Object.fromEntries([...this.kept].map(([id, row]) => [id, { ...row }])) }) }; }
  /** Put a snapshot back silently; refuses a foreign one before changing anything. */
  restore(value: unknown): void {
    const saved = v.parse(ReactionsSaved, value), keys = Object.keys(this.weather.registers);
    if (keys.length !== Object.keys(saved.registers).length || !keys.every(key => Object.hasOwn(saved.registers, key))) throw new RangeError('Incompatible weather reactions');
    const weather = this.weather.prepareWeatherRestore(saved.weather);
    weather(); Object.assign(this.weather.registers, saved.registers); this.elapsed = saved.elapsed;
    this.kept.clear(); for (const [id, row] of Object.entries(saved.kept ?? {})) this.kept.set(id, { ...row });
  }
}
/** Reactions on a page (its scope owns the program) or a renderer-free host (one admitted instance per host scope). */
/** A storm frame's cover (the page forest's stormFrame; a native host's step): indoors no storm starts, and a held storm (a
 *  fight in progress, `weather.storm-hold`) runs on until its fight ends; the reactions read both as `covered` / `held`. */
export function applyWeatherCover(air: { hold: boolean }, inputs: Record<string, number>, indoors: boolean, held: boolean): void {
  air.hold = indoors || held;
  inputs['covered'] = Number(indoors || held); inputs['held'] = Number(held);
}

export function installWeatherReactions(air: WeatherContinuation, rows: WeatherReactionRows, owner: { readonly host: SimHost } | { readonly scope: Scope }): WeatherReactions {
  return new WeatherReactions(air, rows, 'host' in owner ? ReturnProgram.native(owner.host, { script: rows.script, bytes: rows.bytes }) : ReturnProgram.page({ script: rows.script, bytes: rows.bytes }, owner.scope));
}

/** Admit a phase program and its reaction guest as one data-only native bundle. */
export function nativeWeatherBundle(input: unknown, circles?: unknown): { weather: WeatherProgram; reactions: WeatherReactionRows } {
  const data = v.parse(v.object({ weather: v.unknown(),reactions: v.unknown() }),input), weather = parseWeatherProgram(data.weather);
  const reactions=parseWeatherReactions(data.reactions,weather);
  return { weather,reactions:circles===undefined?reactions:parseWeatherReactions({...reactions,shelter:{...reactions.shelter,circles}},weather) };
}
/** The light the creatures see by (rows `light`): the base plus each sun-elevation ramp, held at `storm` while the weather is active. */
export function weatherWorldLight(rows: v.InferOutput<typeof WeatherWorldSchema>['light'], sunElevation: number, active: boolean): number {
  let light = rows.base;
  for (const [from,to,scale] of rows.ramps) { const t = Math.min(1,Math.max(0,(sunElevation-from)/(to-from))); light += scale*(t*t*(3-2*t)); }
  return Math.min(light,active ? rows.storm : 1);
}
