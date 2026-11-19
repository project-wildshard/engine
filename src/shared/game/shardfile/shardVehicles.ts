import type { MoverBox } from '@wildshard/format/moverPose';
import { vehicleCarryHulls } from '@wildshard/format/vehicle-lift';
import { parseVehicles, type Vehicles } from '@wildshard/format/vehicles';
import { outputDescriptor } from './outputDescriptor';
import type { ShardFolder } from './shardFolder';

/**
 * MIRROR-SALT-ZONE MSZ6: a product's `world/vehicles` section (format 0.53.0), read on every install path: the one-shard
 * page, the scene client plan, the grid data cell and the dedicated cell server.
 *
 * MSZ9b: the server's `VehicleRuntime` runs its docks' vehicles and each page follows them (`FollowedVehicles`); format's
 * `vehicleCarryHulls` gives each dock's hull. A product with no section has no vehicles.
 */
export const NO_VEHICLES: Vehicles = Object.freeze({ kinds: [], docks: [] });

const parsed = new WeakMap<object, Vehicles>();

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

/** Each dock's hull in its own frame, by dock id (as `vehicleHulls` gives a steer carry's). */
export function dockHulls(vehicles: Vehicles): ReadonlyMap<string, readonly MoverBox[]> {
  return vehicles.docks.length === 0 ? new Map() : vehicleCarryHulls(vehicles);
}
