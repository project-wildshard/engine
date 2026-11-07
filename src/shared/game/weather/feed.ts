import type { WeatherHUD } from '@wildshard/engine/ui/HUD';
import type { WeatherProgram, WeatherReactionRows } from '@wildshard/format/weatherProgram';

/**
 * The weather a view draws (E6: port first, flip last). A page feeds it from the sim it runs itself; a client feeds it
 * from the `weather.*` rows the server publishes. Nothing that reads this decides anything.
 */
export interface WeatherReading {
  readonly rows: WeatherProgram;
  readonly state: string;
  /** seconds to the next phase */
  readonly phaseLeft: number;
  readonly overcast: number; readonly rain: number; readonly wet: number; readonly wind: number; readonly fog: number;
  readonly n: Readonly<Record<string, number>>;
  readonly registers: Readonly<Record<string, number>>;
}
/** An event's last fields and its `age`, in seconds since it was raised (1e6 before the first). */
export type StormRecord = Readonly<Record<string, number>>;
/** A storm as a view hears it. */
export interface StormReading {
  readonly rows: Pick<WeatherReactionRows, 'steps'>;
  readonly stormActive: boolean; flash: number;
  on: (event: string, listener: (event: StormRecord) => void) => () => void;
  /** Raise a declared event here, for this page's eyes: its record and its listeners, as a row would. */
  raise: (event: string, fields: Readonly<Record<string, number>>) => void;
  record: (event: string) => StormRecord;
  /** The HUD's chip and GET LOW when they changed since the last call, else null; `quiet` holds GET LOW off. */
  hud: (wind: number, quiet: boolean) => WeatherHUD | null;
}
/** What a page's sim needs from a frame of the view: a client's server has its own. */
export interface ClimateSight { readonly x: number; readonly y: number; readonly z: number; readonly crouched: boolean; readonly indoors: boolean; readonly held: boolean }
/** The view's whole line to the climate. */
export interface ClimateFeed {
  readonly weather: WeatherReading;
  readonly storm: StormReading | null;
  /** One render frame, `sight` when the climate has a storm. */
  frame: (dt: number, sight: ClimateSight | null) => void;
  setMode: (mode: string, at?: number) => void;
  /** Jump to a phase, for a dev's `weather` parameter. */
  force: (phase: string, at: number) => void;
}

/** The rows the server publishes a sky under: `state:weather.…`. */
export const WEATHER_ROW = {
  phase: 'weather.phase', left: 'weather.left',
  number: (id: string): string => `weather.n.${id}`, register: (id: string): string => `weather.r.${id}`,
  serial: (event: string): string => `weather.e.${event}.#`, field: (event: string, field: string): string => `weather.e.${event}.${field}`,
} as const;

/** The HUD's chip and GET LOW from the rows. */
export function weatherHud(rows: NonNullable<WeatherReactionRows['hud']>, air: Pick<WeatherReading, 'state' | 'phaseLeft'>, wind: number, getLow: boolean): WeatherHUD {
  const row = rows.chips.find(chip => chip.state === air.state && (chip.within === undefined || air.phaseLeft <= chip.within)), left = Math.max(0, Math.ceil(air.phaseLeft));
  const fill = (text: string): string => text.replaceAll('{left}', `${String(Math.floor(left / 60))}:${String(left % 60).padStart(2, '0')}`).replaceAll('{wind}', String(Math.round(wind)));
  return { chip: row === undefined ? null : { title: fill(row.title), sub: fill(rows.sub), tone: row.tone }, getLow };
}
/** What makes one HUD reading a change from the last. */
export const weatherHudKey = (detail: WeatherHUD): string => `${detail.chip?.title ?? ''}|${detail.chip?.sub ?? ''}|${String(detail.getLow)}`;
