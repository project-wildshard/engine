// oxlint-disable-next-line import/no-nodejs-modules -- The MMO door's public HTTP route.
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as v from 'valibot';
import { actorTags, AGENT_HEADER, AGENTS_REFUSED, carriesAgentMarker, classifyActor, type ActorTags } from '@wildshard/engine/app/actor';
import { ZONE_SELECT_PRESS_PATH, type ZoneSelectDocument } from '@wildshard/engine/game/grid/zoneSelectRows';
import { clientAddress, originAllowed, type DoorTrust } from './doorTrust';

const WINDOW_MS = 60_000, PRESS_LIMIT = 30, MAX_CLIENTS = 8192, MAX_BODY_BYTES = 512;
const Body = v.object({
  slug: v.pipe(v.string(), v.nonEmpty(), v.maxLength(129)),
  channel: v.picklist(['staging', 'production', 'preview']),
  audience: v.optional(v.picklist(['human', 'automation'])),
});
type Press = v.InferOutput<typeof Body>;
interface PressOptions extends DoorTrust {
  readonly channel: ZoneSelectDocument['channel'];
  readonly enterable: (slug: string) => boolean;
  readonly press: (slug: string, actor: ActorTags) => void;
  /** J205 (QA 11-25 row 124): production answers a marked agent's press 403 and counts nothing. */
  readonly refuseAgents?: boolean;
  readonly now?: () => number;
}

async function pressBody(request: IncomingMessage): Promise<Press | null> {
  try {
    let text = '';
    request.setEncoding('utf8');
    for await (const chunk of request.iterator({ destroyOnReturn: false }) as AsyncIterable<string>) {
      text += chunk;
      if (Buffer.byteLength(text) > MAX_BODY_BYTES) return null;
    }
    const row = v.safeParse(Body, JSON.parse(text));
    return row.success ? row.output : null;
  } catch { return null; }
}

/** A press is a funnel observation. Only a room's confirmed seat feeds Popular. */
export function zoneSelectPressRoute(options: PressOptions): (request: IncomingMessage, response: ServerResponse) => boolean {
  let minute = -1;
  const counts = new Map<string, number>(), now = options.now ?? Date.now;
  function withinLimit(peer: string): boolean {
    const current = Math.floor(now() / WINDOW_MS);
    if (minute !== current) { minute = current; counts.clear(); }
    const count = counts.get(peer) ?? 0;
    if (count >= PRESS_LIMIT || (count === 0 && counts.size >= MAX_CLIENTS)) return false;
    counts.set(peer, count + 1);
    return true;
  }
  async function record(request: IncomingMessage, response: ServerResponse, at: URL): Promise<void> {
    const row = await pressBody(request);
    if (row === null) { request.resume(); response.writeHead(400).end(); return; }
    const { channel, enterable, trustProxy } = options;
    if (channel !== 'preview' && row.channel === channel
      && withinLimit(clientAddress(request.socket.remoteAddress ?? '', request.headers, trustProxy)) && enterable(row.slug)) {
      const header = request.headers[AGENT_HEADER];
      const actor = classifyActor({ userAgent: request.headers['user-agent'], header: typeof header === 'string' ? header : null,
        query: at.searchParams.get('agent'), harness: row.audience === 'automation' });
      if (options.refuseAgents === true && carriesAgentMarker(actor)) {
        response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end(AGENTS_REFUSED);
        return;
      }
      options.press(row.slug, actorTags(actor));
    }
    response.writeHead(204).end();
  }
  return (request, response) => {
    if (request.url?.split('?')[0] !== ZONE_SELECT_PRESS_PATH) return false;
    const origin = request.headers.origin;
    response.setHeader('Vary', 'Origin');
    response.setHeader('Cache-Control', 'no-store');
    if (origin === undefined || !originAllowed(origin, options.allowedOrigins)) { request.resume(); response.writeHead(403).end(); return true; }
    response.setHeader('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': `Content-Type, ${AGENT_HEADER}` }).end();
    } else if (request.method === 'POST') {
      void record(request, response, new URL(request.url, 'http://localhost'));
    } else { response.writeHead(405, { Allow: 'POST, OPTIONS' }).end(); }
    return true;
  };
}
