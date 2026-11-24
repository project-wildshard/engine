// MMO-OBSERVABILITY OB5/OB6 (meta docs/plans/MMO-OBSERVABILITY-PLAN.md): what the door tells `/metrics` about its game sockets. Each
// event carries only the link's kind (human or agent, phone or desktop), never who: `/metrics` keeps histograms and counts, no row per
// player. A type-only module, so the world never loads the metrics client.
import type { DeviceSnapshot } from '@wildshard/engine/net/deviceWord';
import type { StatsWord } from '@wildshard/engine/net/statsWord';
import type { TransportStats } from '@wildshard/engine/net/transport';

/** A link's kind: what the door's mark says (`actor.ts`), and the device word's class (`deviceClass`) once the page has said it. */
export interface LinkKind { readonly actor: 'human' | 'agent'; readonly device: DeviceClass }
export type DeviceClass = 'phone' | 'desktop' | 'unknown';
/** One open link at scrape time. */
export interface LinkRow extends LinkKind { readonly buffered: number; readonly sentBytes: number; readonly recvBytes: number; readonly skipped: number }

/** Where the door sends its link events: `/metrics` (`ServerMetrics`), or nothing. */
export interface LinkEvents {
  /** A page's ping, with the round trip it measured on its own clock (`encodePing`). */
  readonly rtt: (ms: number, kind: LinkKind) => void;
  /** A link ended, why (the close reason: `stalled`, `refused`, `replaced`, `lost` …), and what it moved. */
  readonly closed: (reason: string, kind: LinkKind, stats: TransportStats, skipped: number) => void;
  /** A page's 10 s stats word (`statsWord.ts`), already bounded. */
  readonly stats: (word: StatsWord, kind: LinkKind) => void;
}

/** The device word's coarse class: a touch screen under 1000 CSS px wide, or one that says it is mobile, is a phone. */
export function deviceClass(said: DeviceSnapshot | undefined): DeviceClass {
  if (said === undefined) return 'unknown';
  if (said.mobile === true) return 'phone';
  const narrow = Math.min(said.screenW ?? Infinity, said.screenH ?? Infinity) < 1000;
  return (said.touch ?? 0) > 0 && narrow ? 'phone' : 'desktop';
}
