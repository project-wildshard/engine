import type { SimHost } from '@wildshard/engine/sim';
import { declaredPortals, installHostPortalRide, releasePortalRides, type PortalFacts, type PortalRide, type PortalRideRows, type PortalSource } from '../../../shared/game/shardfile/portalRide';
import { registerInstalled } from './installedSides';

/** A `client/plan` feature row, as far as the portal reads it. */
interface PlanFeature { readonly kind: string; readonly rows?: unknown }

/** The `portal.ride` rows a product's `client/plan` declares, or null when it declares none. */
export function planPortalRide(features: readonly PlanFeature[]): PortalRideRows | null {
  const row = features.find(feature => feature.kind === 'portal.ride');
  return row === undefined ? null : row.rows as PortalRideRows;
}

/** ONE-FORMAT OF41b (Q-S9, J367 (4)): the `portal` primitive from a plain upload. A shard whose entryways declare a
 * `portalLink` and whose `client/plan` declares its `portal.ride` rows rides on the server as a native product's
 * `portal.ride` assembly row does (`nativeAssemblyHosts.ts`): the same host ride under the director's id, the landing
 * facts to `facts`. The page installs its own half from the same rows (`client/shardfile/portalRideBinding.ts`). A shard
 * with no portal link, or no ride rows, installs nothing. */
export function installDeclaredHostPortalRide(host: SimHost, source: PortalSource, rows: PortalRideRows | null, facts: PortalFacts): PortalRide | null {
  if (rows === null || declaredPortals(source).length === 0) return null;
  const ride = installHostPortalRide(host, rows.director, source, rows, facts);
  registerInstalled(host, 'portalRide');
  return ride;
}

/** A room's seat its player left rides its portals anew, as the next page's ride does. */
export function releaseSeatPortals(host: SimHost, player: string): void { releasePortalRides(host, player); }
