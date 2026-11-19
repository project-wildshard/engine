import type { MoverBox } from '@wildshard/format/moverPose';
import type { MoverData } from '@wildshard/format/movers';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { vehicleCarryHulls, vehicleCarryMovers } from '@wildshard/format/vehicle-lift';
import { parseVehicles, type Vehicles } from '@wildshard/format/vehicles';
import { outputDescriptor } from './outputDescriptor';
import type { ShardFolder } from './shardFolder';

/**
 * MIRROR-SALT-ZONE MSZ6: a product's `world/vehicles` section (format 0.53.0), read on every install path: the one-shard
 * page, the scene client plan, the grid data cell and the dedicated cell server.
 *
 * Until MSZ8's vehicle runtime spawns from docks, each dock runs as the steer carry this engine already drives: format's
 * `vehicleCarryMovers` lowers it after the product's own movers, and `vehicleCarryHulls` gives its hull. A product with no
 * section loads as before: the same source object, the same movers.
 */
export const NO_VEHICLES: Vehicles = Object.freeze({ kinds: [], docks: [] });

/** sharddev numbers a scene's movers from 9101 (`scene/shardfile.ts`); docks follow the product's last one. */
const MOVER_ENTITY_BASE = 9101;
const parsed = new WeakMap<object, Vehicles>(), docked = new WeakMap<object, object>();

/** An admitted `world/vehicles` value, parsed once per section object. */
export function vehiclesSection(section: unknown): Vehicles {
  if (section === undefined) return NO_VEHICLES;
  if (typeof section !== 'object' || section === null) return parseVehicles(section);
  const known = parsed.get(section); if (known !== undefined) return known;
  const rows = parseVehicles(section); parsed.set(section, rows); return rows;
}

/** The source's vehicles: from the sections given, else its own admitted ones (`outputDescriptor`). Format's
 * `HEADLESS_CONTEXT_SECTIONS` (0.53.0) leaves the section out of a cell server's forwarded sections, so both are read. */
export function shardVehicles(source: unknown, sections?: ReadonlyMap<string, unknown>): Vehicles {
  return vehiclesSection(sections?.get('world/vehicles') ?? outputDescriptor(source)?.sections.get('world/vehicles'));
}

/** A folder product's vehicles (`ShardFolder`): none when its index lists no section. */
export function folderVehicles(product: Pick<ShardFolder, 'has' | 'section'>): Vehicles {
  return product.has('world/vehicles') ? vehiclesSection(product.section('world/vehicles')) : NO_VEHICLES;
}

/** `movers` with each dock after them as a steer carry; `movers` itself when there are no docks. */
export function dockedMovers(movers: MoverData, vehicles: Vehicles): MoverData {
  if (vehicles.docks.length === 0) return movers;
  const next = movers.reduce((most, row) => Math.max(most, row.entity + 1), MOVER_ENTITY_BASE);
  return [...movers, ...vehicleCarryMovers(vehicles, next)];
}

/** Each dock's hull in its own frame, by dock id (as `vehicleHulls` gives a steer carry's). */
export function dockHulls(vehicles: Vehicles): ReadonlyMap<string, readonly MoverBox[]> {
  return vehicles.docks.length === 0 ? new Map() : vehicleCarryHulls(vehicles);
}

/** The source with its docks among its movers: the same object when it has none, and one copy per source otherwise, so a
 * level and its binder (or a page and its play list) see the same rows. The copy keeps `files`, so it keeps its sections. */
export function dockedShard<T extends Pick<Shardfile, 'movers'>>(source: T, vehicles: Vehicles = shardVehicles(source)): T {
  if (vehicles.docks.length === 0) return source;
  const known = docked.get(source); if (known !== undefined) return known as T;
  const copy: T = { ...source, movers: dockedMovers(source.movers, vehicles) };
  docked.set(source, copy); docked.set(copy, copy);
  return copy;
}
