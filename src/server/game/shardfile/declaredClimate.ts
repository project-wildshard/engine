import type { ShardRows } from '@wildshard/format/rows';
import { fnv1a32, Rng } from '@wildshard/format/seededRng';
import type { SimHost } from '@wildshard/engine/sim';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { publishDay } from '@wildshard/engine/sim/shardRows';
import { declaredDay, declaredWeather } from '../../../shared/game/shard/declaredRows';
import { publishWeather } from '../weather/wire';

const climateDays = new WeakMap<SimHost, Pick<ReturnType<typeof declaredDay>, 'dayPhase'>>();
/** The day `host` runs: its own clock, else the shard's authored `world/days` row this installed (OF29a's `time` reads it). */
export function hostDay(host: SimHost): Pick<ReturnType<typeof declaredDay>, 'dayPhase'> | undefined { return host.dayClock ?? climateDays.get(host); }

/**
 * A shard's authored day and weather on the server, which steps them and publishes them as rows. Like the page's own they
 * are no part of a save, so a world starts its sky where the shard authored it. A host with a director's clock keeps that one.
 * Weather draws from its own seed: the host's streams are in a save, and this may not change what one holds.
 */
export function installDeclaredClimate(host: SimHost, rows: Pick<ShardRows, 'days' | 'weather'>): void {
  const borrowed = host.dayClock, authored = rows.days[0], own = borrowed === undefined && authored !== undefined ? declaredDay(authored) : undefined, day = borrowed ?? own ?? null;
  if (own !== undefined) climateDays.set(host, own);
  // OF23e3: a row that names its program runs in its native assembly (`withProgramWeather`), not here
  const weathers = rows.weather.flatMap(row => 'program' in row ? [] : [declaredWeather(row, new Rng(fnv1a32(`${String(host.level.seed)}:${row.id}`)))]);
  if (own !== undefined) { publishDay(host, own); actRoutes(host).day = phase => { if (host.players.size === 1 && !own.paused) own.phase = phase; }; }
  const [sky] = weathers;
  if (sky !== undefined) publishWeather(host, sky);
  if (own === undefined && weathers.length === 0) return;
  host.onStep('climate.declared', dt => { own?.update(dt); for (const weather of weathers) weather.update(dt, day); });
}
