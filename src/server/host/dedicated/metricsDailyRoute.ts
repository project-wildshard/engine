// oxlint-disable-next-line import/no-nodejs-modules -- Public aggregate counts on the dedicated room's HTTP door.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ReadRoomMetricDay, RoomMetricChannel, RoomMetricDay } from './saves/metricsDailyStore';

const DAY_MS = 86_400_000;
const LOOKBACK = 45;
const CACHE_MS = 60_000;

interface RoomDailyOptions {
  readonly channel: RoomMetricChannel;
  readonly read: ReadRoomMetricDay;
  readonly log: (line: Record<string, unknown>) => void;
  readonly now?: () => number;
}
interface PendingDay { readonly expires: number; readonly result: Promise<RoomMetricDay> }

const PATH = '/metrics/daily/';

function acceptedDay(path: string, now: number): string | null {
  const day = path.slice(PATH.length);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return null;
  const start = Date.parse(day);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== day) return null;
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  return start <= today && start > today - LOOKBACK * DAY_MS ? day : null;
}

/** This route exposes summary values only. The Prometheus port stays in loopback. */
export function roomMetricsDailyRoute(options: RoomDailyOptions): (request: IncomingMessage, response: ServerResponse) => boolean {
  const cache = new Map<string, PendingDay>(), now = options.now ?? Date.now;
  const read = (day: string): Promise<RoomMetricDay> => {
    const at = now(), before = cache.get(day);
    if (before !== undefined && at < before.expires) return before.result;
    if (cache.size >= LOOKBACK) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    const expires = at + CACHE_MS, result = readDay(day, expires);
    cache.set(day, { expires, result });
    return result;
  };
  async function readDay(day: string, expires: number): Promise<RoomMetricDay> {
    try { return await options.read(options.channel, day); }
    catch (error: unknown) { if (cache.get(day)?.expires === expires) cache.delete(day); throw error; }
  }
  async function reply(day: string, response: ServerResponse): Promise<void> {
    try {
      const document = await read(day);
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' }).end(JSON.stringify(document));
    } catch (error: unknown) {
      options.log({ at: 'metrics.daily-unavailable', channel: options.channel, error: String(error) });
      response.writeHead(503).end();
    }
  }
  return (request, response) => {
    const url = new URL(request.url ?? '/', 'http://rooms.invalid');
    if (!url.pathname.startsWith(PATH)) return false;
    if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }).end(); return true; }
    const day = acceptedDay(url.pathname, now());
    if (day === null) { response.writeHead(400).end(); return true; }
    void reply(day, response);
    return true;
  };
}
