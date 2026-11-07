import { CONTENT_CAPS } from '../core/config';

/** Wire and CPU work needed before a neighbour can own a traveler. Hybrid bytes describe its runtime chunk. */
export interface ReadinessBundle { criticalWireBytes: number; hybridWireBytes: number; decodeSeconds: number; runtimeParseSeconds: number }
/** Platform travel envelope; link rate is bits per second, all time inputs are seconds. */
export interface ReadinessLink { speed: number; linkBitsPerSecond: number; requestLatencySeconds: number; maxStallSeconds: number }
/** Separate critical and hybrid lines, conservatively sharing the link in sequence. */
export interface ReadinessEstimate { criticalTransferSeconds: number; hybridTransferSeconds: number; criticalSeconds: number; hybridSeconds: number; seconds: number; distance: number }

/** Compute the cold-cache bound. A hybrid runtime's second request and parse cannot disappear into the sim budget. */
export function readinessModel(bundle: ReadinessBundle, link: ReadinessLink): ReadinessEstimate {
  // Preserve the initial read batch before the first refusal, without a transient validation array.
  const criticalBytes = bundle.criticalWireBytes, hybridBytes = bundle.hybridWireBytes, decode = bundle.decodeSeconds, runtimeParse = bundle.runtimeParseSeconds;
  const speed = link.speed, bits = link.linkBitsPerSecond, latency = link.requestLatencySeconds, stall = link.maxStallSeconds;
  if (!Number.isFinite(criticalBytes) || criticalBytes < 0
    || !Number.isFinite(hybridBytes) || hybridBytes < 0
    || !Number.isFinite(decode) || decode < 0
    || !Number.isFinite(runtimeParse) || runtimeParse < 0
    || !Number.isFinite(speed) || speed < 0
    || !Number.isFinite(bits) || bits < 0
    || !Number.isFinite(latency) || latency < 0
    || !Number.isFinite(stall) || stall < 0) throw new RangeError('Invalid readiness envelope');
  if (!Number.isSafeInteger(bundle.criticalWireBytes) || !Number.isSafeInteger(bundle.hybridWireBytes) || bundle.criticalWireBytes > CONTENT_CAPS.sim.compressed || link.linkBitsPerSecond === 0) throw new RangeError('Critical wire cap or invalid link rate');
  const criticalTransferSeconds = bundle.criticalWireBytes * 8 / link.linkBitsPerSecond;
  const hybridTransferSeconds = bundle.hybridWireBytes * 8 / link.linkBitsPerSecond;
  const criticalSeconds = link.requestLatencySeconds + criticalTransferSeconds + link.maxStallSeconds + bundle.decodeSeconds;
  const hybridSeconds = (bundle.hybridWireBytes > 0 ? link.requestLatencySeconds : 0) + hybridTransferSeconds + bundle.runtimeParseSeconds;
  const seconds = criticalSeconds + hybridSeconds;
  return { criticalTransferSeconds, hybridTransferSeconds, criticalSeconds, hybridSeconds, seconds, distance: link.speed * seconds };
}

/** Completion belongs to this particular residency attempt, never merely a slug shared by several placements. */
export interface ReadinessTicket { readonly instance: string; readonly generation: number }
/** Collision installation, sim initialization and runtime parsing each have their own completion fence. */
export type ReadinessPart = 'colliders' | 'sim' | 'runtime';
/** Frozen public status; unknown and out-of-bounds neighbours are closed by default. */
export interface ReadinessStatus { requested: boolean; ready: boolean; colliders: boolean; sim: boolean; runtime: boolean; proxy: boolean }
interface Entry { ticket: ReadinessTicket; colliders: boolean; sim: boolean; runtime: boolean }

/** Node-safe readiness fence. Call request from radial distance every fixed step, so a U-turn cannot skip prefetch. */
export class TraversalReadiness {
  private readonly entries = new Map<string, Entry>();
  private generation = 0;

  /** Return a ticket once when the distance bound is reached; returning null never cancels an existing attempt. */
  request(instance: string, distance: number, estimate: ReadinessEstimate, hybrid: boolean): ReadinessTicket | null {
    if (instance.length === 0 || !Number.isFinite(distance) || distance < 0 || !Number.isFinite(estimate.distance) || estimate.distance < 0) throw new RangeError('Invalid readiness request');
    if (distance > estimate.distance || this.entries.has(instance)) return null;
    const ticket = Object.freeze({ instance, generation: ++this.generation });
    this.entries.set(instance, { ticket, colliders: false, sim: false, runtime: !hybrid });
    return ticket;
  }

  /** A late result from an unloaded or failed attempt cannot reopen its edge. */
  complete(ticket: ReadinessTicket, part: ReadinessPart): boolean {
    const entry = this.entries.get(ticket.instance);
    if (entry === undefined || entry.ticket.generation !== ticket.generation) return false;
    entry[part] = true;
    return true;
  }

  /** Unload or admission failure closes the edge before the next movement call. */
  invalidate(instance: string): void { this.entries.delete(instance); }

  /** Current movement gate without allocating a diagnostic status record. */
  isReady(instance: string | null): boolean {
    const entry = instance === null ? undefined : this.entries.get(instance);
    return entry?.colliders === true && entry.sim && entry.runtime;
  }

  /** Bound proxies have no sim to request; their closed edge still rests on the platform's permanent deck. */
  status(instance: string | null): ReadinessStatus {
    const entry = instance === null ? undefined : this.entries.get(instance);
    const colliders = entry?.colliders ?? false, sim = entry?.sim ?? false, runtime = entry?.runtime ?? false;
    return { requested: entry !== undefined, ready: colliders && sim && runtime, colliders, sim, runtime, proxy: instance === null };
  }
}
