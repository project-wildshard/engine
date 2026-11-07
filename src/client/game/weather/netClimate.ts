import type { NetClient } from '@wildshard/engine/net/client';
import type { NetClimateAct } from '@wildshard/engine/net/acts';
import type { WeatherHUD } from '@wildshard/engine/ui/HUD';
import type { WeatherProgram, WeatherReactionRows } from '@wildshard/format/weatherProgram';
import { WEATHER_ROW, weatherHud, weatherHudKey, type ClimateFeed, type StormReading, type StormRecord, type WeatherReading } from '../../../shared/game/weather/feed';

/** A page's word on the sky, as an act carries it. */
export type ClimateWord = Pick<NetClimateAct, 'op' | 'name' | 'at'>;
/** The numbers a program's weather always has, then what its rows add. */
const numberIds = (rows: WeatherProgram): readonly string[] => [...new Set(['overcast', 'rain', 'wet', 'wind', 'fog', ...Object.keys(rows.initial ?? {}), ...Object.keys(rows.outputs)])];

/** The sky off the wire. */
class NetWeather implements WeatherReading {
  readonly n: Record<string, number>;
  readonly registers: Record<string, number>;
  state: string;
  phaseLeft = 0;
  constructor(readonly rows: WeatherProgram) {
    this.state = rows.states[0] ?? '';
    this.n = Object.fromEntries(numberIds(rows).map(id => [id, 0])); this.registers = { ...rows.registers };
  }
  get overcast(): number { return this.n['overcast'] ?? 0; }
  get rain(): number { return this.n['rain'] ?? 0; }
  get wet(): number { return this.n['wet'] ?? 0; }
  get wind(): number { return this.n['wind'] ?? 0; }
  get fog(): number { return this.n['fog'] ?? 0; }
}
/** A storm off the wire: an event plays when its serial moves. */
class NetStorm implements StormReading {
  private readonly records = new Map<string, { readonly record: Record<string, number>; serial: number }>();
  private readonly listeners = new Map<string, Set<(event: StormRecord) => void>>();
  private hudSeen = '';
  constructor(readonly rows: WeatherReactionRows, private readonly weather: NetWeather) {
    for (const emit of rows.steps.flatMap(step => step.emit)) {
      const row = this.records.get(emit.event) ?? { record: { age: 1e6 }, serial: 0 };
      for (const [field] of emit.fields) row.record[field] = 0;
      this.records.set(emit.event, row);
    }
  }
  get stormActive(): boolean { return this.rows.active.includes(this.weather.state); }
  get flash(): number { return this.weather.registers[this.rows.flash] ?? 0; }
  set flash(value: number) { this.weather.registers[this.rows.flash] = value; }
  raise(event: string, fields: Readonly<Record<string, number>>): void {
    const row = this.records.get(event); if (row === undefined) throw new Error(`Undeclared weather reaction: ${event}`);
    Object.assign(row.record, fields); row.record['age'] = 0;
    for (const listener of this.listeners.get(event) ?? []) listener(row.record);
  }
  on(event: string, listener: (event: StormRecord) => void): () => void {
    const set = this.listeners.get(event) ?? new Set(); set.add(listener); this.listeners.set(event, set);
    return () => { set.delete(listener); };
  }
  record(event: string): StormRecord { const row = this.records.get(event); if (row === undefined) throw new Error(`Undeclared weather reaction: ${event}`); return row.record; }
  hud(wind: number, quiet: boolean): WeatherHUD | null {
    const rows = this.rows.hud; if (rows === undefined) return null;
    const detail = weatherHud(rows, this.weather, wind, (this.weather.registers[rows.low] ?? 0) === 1 && !quiet), key = weatherHudKey(detail);
    if (key === this.hudSeen) return null;
    this.hudSeen = key; return detail;
  }
  /** One frame's rows: `read` gives a row's value, undefined until the server has sent it. */
  sync(dt: number, read: (name: string) => number | undefined): void {
    for (const [event, row] of this.records) {
      const { record } = row, serial = read(WEATHER_ROW.serial(event)) ?? row.serial;
      record['age'] = Math.min(1e6, (record['age'] ?? 0) + dt);
      if (serial === row.serial) continue;
      row.serial = serial;
      for (const field of Object.keys(record)) { const value = field === 'age' ? undefined : read(WEATHER_ROW.field(event, field)); if (value !== undefined) record[field] = value; }
      record['age'] = 0;
      for (const listener of this.listeners.get(event) ?? []) listener(record);
    }
  }
}

/** The climate a client's view reads: the server's, off the `weather.*` rows it publishes. It stands in for the page's
 * `pageClimate` at the flip, and steps nothing: a frame only reads the newest rows. A setting's mode and a dev's phase jump
 * go up through `say`. */
export function netClimate(client: Pick<NetClient, 'latest' | 'stateField'>, rows: { readonly weather: WeatherProgram; readonly reactions?: WeatherReactionRows }, say: (word: ClimateWord) => void): ClimateFeed {
  const weather = new NetWeather(rows.weather), storm = rows.reactions === undefined ? null : new NetStorm(rows.reactions, weather);
  return { weather, storm, setMode: (name, at) => { say({ op: 'mode', name, at: at ?? -1 }); }, force: (name, at) => { say({ op: 'force', name, at }); },
    frame: dt => {
      const frame = client.latest; if (frame === null) return;
      const read = (name: string): number | undefined => client.stateField(frame, name);
      weather.state = rows.weather.states[read(WEATHER_ROW.phase) ?? -1] ?? weather.state;
      weather.phaseLeft = read(WEATHER_ROW.left) ?? weather.phaseLeft;
      for (const id of Object.keys(weather.n)) weather.n[id] = read(WEATHER_ROW.number(id)) ?? weather.n[id] ?? 0;
      for (const id of Object.keys(weather.registers)) weather.registers[id] = read(WEATHER_ROW.register(id)) ?? weather.registers[id] ?? 0;
      storm?.sync(dt, read);
    } };
}
