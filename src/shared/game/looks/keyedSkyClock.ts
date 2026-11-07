import { parseKeyedSky, SKY_PRESET, type KeyedSkyStyle } from '@wildshard/format/keyedSky';
import { dayClock, type DayClock } from './dayClock';
import type { DayLookPreset } from './dayLookPresets';

export type SkyPreset = DayLookPreset<typeof SKY_PRESET>;
export type KeyedSkyDay = DayClock<typeof SKY_PRESET, KeyedSkyStyle>;
/** Renderer-free clock. Each field, curve and preset is admitted JSON. */
export function keyedSkyDay(input: unknown): KeyedSkyDay {
  return dayClock(SKY_PRESET, parseKeyedSky(input), { lamps: 'lamps' });
}
/** A keyed sky row's clock spec alone (G571): what a headless assembly hands the engine's `DayCycle` from the shard's
 *  look/keyed-sky section, so no shard module carries its day. */
export function keyedSkyDaySpec(input: unknown): KeyedSkyDay['spec'] {
  return keyedSkyDay(input).spec;
}
