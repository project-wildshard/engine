import { outputSectionPayloads } from '@wildshard/format/outputFields';
import { PRIMITIVES, derivePrimitives, primitiveOfHost } from '@wildshard/format/primitives';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';

/** ONE-FORMAT OF17b1 (J365 (6), Q-T22 (b)): no host list ships. The server works its primitive list out at load from
 * the product's own sections (format `derivePrimitives`), and, until M8 empties `server/native-assembly.json`, adds the
 * family each native feature joins (format `primitiveOfHost`, the HOSTS.md table). A host outside the table adds
 * nothing. The list is in table order, one entry per family. */
export function productPrimitives(shard: Shardfile, nativeHosts: readonly string[] = []): readonly string[] {
  const on = new Set(derivePrimitives(outputSectionPayloads(shard)).map(row => row.name));
  for (const host of nativeHosts) { const family = primitiveOfHost(host); if (family !== undefined) on.add(family); }
  return PRIMITIVES.flatMap(row => on.has(row.name) ? [row.name] : []);
}

const lists = new WeakMap<SimHost, readonly string[]>();

/** Record `host`'s primitive list at load. A native install after the declared bind widens it with its own families. */
export function recordPrimitives(host: SimHost, shard: Shardfile, nativeHosts: readonly string[] = []): void {
  const known = lists.get(host), next = productPrimitives(shard, nativeHosts);
  lists.set(host, known === undefined ? next : PRIMITIVES.flatMap(row => known.includes(row.name) || next.includes(row.name) ? [row.name] : []));
}

/** The primitive families this host runs; empty before any load recorded them. */
export function primitivesOf(host: SimHost): readonly string[] { return lists.get(host) ?? []; }
