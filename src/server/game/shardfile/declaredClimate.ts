import type { ShardRows } from '@wildshard/format/rows';
import { fnv1a32, Rng } from '@wildshard/engine/core/rng';
import type { SimHost } from '@wildshard/engine/sim';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { publishDay } from '@wildshard/engine/sim/shardRows';
import { declaredDay, declaredWeather } from '../../../shared/game/shard/declaredRows';
import { publishWeather } from '../weather/wire';

/**
 * A data shard's authored day and weather on the server, which steps them and publishes them as rows. Like the page's own they
 * are no part of a save, so a world starts its sky where the shard authored it. A host with a director's clock keeps that one.
 * Weather draws from its own seed: the host's streams are in a save, and this may not change what one holds.
 */
export function installDeclaredClimate(host: SimHost, rows: Pick<ShardRows, 'days' | 'weather'>): void {
  const borrowed = host.dayClock, authored = rows.days[0], own = borrowed === undefined && authored !== undefined ? declaredDay(authored) : undefined, day = borrowed ?? own ?? null;
  const weathers = rows.weather.map(row => declaredWeather(row, new Rng(fnv1a32(`${String(host.level.seed)}:${row.id}`))));
  if (own !== undefined) { publishDay(host, own); actRoutes(host).day = phase => { if (host.players.size === 1 && !own.paused) own.phase = phase; }; }
  const [sky] = weathers;
  if (sky !== undefined) publishWeather(host, sky);
  if (own === undefined && weathers.length === 0) return;
  host.onStep('climate.declared', dt => { own?.update(dt); for (const weather of weathers) weather.update(dt, day); });
}
