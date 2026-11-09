import { Vector3 } from 'three';
import { hitHistoryOf } from '@wildshard/engine/combat/rewind';
import type { DamageRequest } from '@wildshard/engine/combat/pipeline';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { RewoundBody } from '@wildshard/engine/net/hitHistory';
import type { SimHost } from '@wildshard/engine/sim';
import { createNativeTargetQueries, type NativeTargetHit } from './simulation';
import type {HitRewind} from '@wildshard/engine/net/measurements';

/** A contact read from where the shooter saw the body. `point` is where it lands on the living body, as damage lands now. */
export type SeenHit = NativeTargetHit<AnimalSim> & { readonly seen: Vector3;rewind?:HitRewind };

/** The bodies as a command's `viewTick` saw them (J50), or null to read them where they stand: a tape, a page, a held tick. */
export function seenBodies(host: SimHost, viewTick: number | undefined): readonly RewoundBody[] | null {
  return viewTick === undefined || viewTick === 0 ? null : hitHistoryOf(host)?.at(viewTick) ?? null;
}

const rays = createNativeTargetQueries<RewoundBody>();
const contact: SeenHit = { body: null, head: false, distance: 0, point: new Vector3(), seen: new Vector3() };
/** The nearest of `bodies` along a ray. The result is reused: read it before the next query. */
export function seenRay(bodies: readonly RewoundBody[], origin: Vector3, direction: Vector3, max: number): SeenHit | null {
  const hit = rays.ray(bodies, origin, direction, max), body = hit?.body ?? null;
  if (hit === null || body === null) return null;
  contact.body = body.body; contact.head = hit.head; contact.distance = hit.distance;
  contact.seen.copy(hit.point); body.present(hit.point, contact.point);
  if(body.rewind===undefined)delete contact.rewind;else contact.rewind=body.rewind;
  return contact;
}
/** How far `target` stood from where it stands now, for aim at a named body; null when it has not moved for this view. */
export function seenShift(host: SimHost, viewTick: number, target: AnimalSim, out: Vector3): Vector3 | null {
  const seen = seenBodies(host, viewTick)?.find(row => row.body === target);
  return seen === undefined ? null : out.subVectors(seen.position, target.position);
}
/** A blow as the pipeline should settle it: the wire keeps where its shooter saw it. */
export function seenRequest(req: DamageRequest, hit: { readonly seen?: Vector3;readonly rewind?:HitRewind }): DamageRequest {
  return hit.seen === undefined ? req : { ...req, seen: hit.seen,...(hit.rewind===undefined?{}:{rewind:hit.rewind}) };
}
