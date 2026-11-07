import type { DayCycleClock } from '@wildshard/engine/world/dayCycle';
import type { ForestWeatherRows } from '@wildshard/format/forestWeather';
import { parseWeatherProgram, parseWeatherReactions, WeatherWorldSchema } from '@wildshard/format/weatherProgram';
import * as v from 'valibot';
import type { ClimateFeed } from '../../../shared/game/weather/feed';
import { pageAir } from '../population/pageAir';
import { wirePage } from '../shardfile/wirePage';
import { netClimate } from './netClimate';

/** A page's light from its rows: the base plus each sun-elevation ramp, held at `storm` while the weather is active. */
function airLight(rows: v.InferOutput<typeof WeatherWorldSchema>['light'], sunElevation: number, active: boolean): number {
  let light = rows.base;
  for (const [from, to, scale] of rows.ramps) { const t = Math.min(1, Math.max(0, (sunElevation - from) / (to - from))); light += scale * (t * t * (3 - 2 * t)); }
  return Math.min(light, active ? rows.storm : 1);
}
/** The program a page reads its sky by: the phase program, or the storm's bundle when the rows declare a storm. */
function skyRows(policy: ForestWeatherRows, input: unknown): Parameters<typeof netClimate>[1] {
  if (policy.storm === undefined) return { weather: parseWeatherProgram(input) };
  const data = v.parse(v.object({ weather: v.unknown(), reactions: v.unknown() }), input), weather = parseWeatherProgram(data.weather);
  return { weather, reactions: parseWeatherReactions(data.reactions, weather) };
}
/** The sky a forest page's views read (J130): the server's, off its rows. A setting's mode goes up, and the light follows it. */
export function pageSky(policy: ForestWeatherRows, program: unknown, clock: Pick<DayCycleClock, 'sunElevation'>): ClimateFeed {
  const feed = netClimate(wirePage.climateRows, skyRows(policy, program), word => { wirePage.climate(word); });
  const world = policy.storm === undefined ? null : v.parse(WeatherWorldSchema, policy.storm.world);
  return { ...feed, frame: (dt, sight) => {
    feed.frame(dt, sight);
    if (world === null) return;
    pageAir.storm = feed.storm?.stormActive === true; pageAir.light = airLight(world.light, clock.sunElevation, pageAir.storm);
  } };
}
