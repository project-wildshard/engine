// oxlint-disable-next-line import/no-nodejs-modules -- Public aggregates on the dedicated room's HTTP door.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RoomMetricChannel } from './saves/metricsDailyStore';
import type { ZoneEntryTotal } from './saves/zoneEntries';
import type { World } from './world';
import type { ZoneSelectDocument } from '@wildshard/engine/game/grid/zoneSelectRows';

const PREFIX = '/metrics/current/';
const MINUTE_MS = 60_000;
const WINDOWS = new Map([['1', 1], ['7', 7], ['30', 30]]);
interface RoomOverview {
  readonly channel: RoomMetricChannel;
  readonly days: number;
  readonly at: number;
  readonly live: ReturnType<World['livePlayers']>;
  readonly arrivals: readonly ZoneEntryTotal[];
  readonly popular: readonly ZoneSelectDocument['popular'][number]['slug'][];
}
interface OverviewOptions {
  readonly channel: RoomMetricChannel;
  readonly live: () => ReturnType<World['livePlayers']>;
  readonly entries: (days: number) => Promise<readonly ZoneEntryTotal[]>;
  readonly selection: (entries: readonly ZoneEntryTotal[]) => Promise<Pick<ZoneSelectDocument, 'popular'>>;
  readonly log: (line: Record<string, unknown>) => void;
  readonly now?: () => number;
}

export function metricsCurrentRoute(options: OverviewOptions): (request: IncomingMessage, response: ServerResponse) => boolean {
  const reads = new Map<number, { readonly at: number; readonly result: Promise<RoomOverview> }>();
  const now = options.now ?? Date.now;
  async function roomOverview(days: number, at: number): Promise<RoomOverview> {
    try {
      const arrivals = await options.entries(days), selection = await options.selection(arrivals);
      return { channel: options.channel, days, at, live: options.live(), arrivals, popular: selection.popular.map(row => row.slug) };
    } catch (error: unknown) {
      if (reads.get(days)?.at === at) reads.delete(days);
      throw error;
    }
  }
  async function send(days: number, response: ServerResponse): Promise<void> {
    const at = now(), sent = reads.get(days);
    const available = sent !== undefined && at - sent.at < MINUTE_MS ? sent : { at, result: roomOverview(days, at) };
    reads.set(days, available);
    try {
      const data = await available.result;
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' }).end(JSON.stringify(data));
    } catch (error: unknown) {
      options.log({ at: 'metrics.current-unavailable', channel: options.channel, error: String(error) });
      response.writeHead(503).end();
    }
  }
  return (request, response) => {
    const path = request.url?.split('?')[0] ?? '';
    if (!path.startsWith(PREFIX)) return false;
    const days = WINDOWS.get(path.slice(PREFIX.length));
    if (days === undefined) { response.writeHead(404).end(); return true; }
    if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }).end(); return true; }
    void send(days, response);
    return true;
  };
}
