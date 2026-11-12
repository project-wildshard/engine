// VPS-HARDENING VH10: who the door believes. A forwarded header is a claim, and only the proxy in front may make it, so the server reads
// exactly one, chosen by `TRUST_PROXY`, and only from a loopback peer:
//   caddy       the last `X-Forwarded-For` hop: the one the proxy itself appended. Tailscale Funnel and Serve drop any client
//               `X-Forwarded-*` and set one `X-Forwarded-For` from the ingress source (tailscale `ipn/ipnlocal/serve.go`
//               `addProxyForwardedHeaders`), and Caddy appends the peer it saw, so the last hop is right for both. `CF-Connecting-IP`
//               is ignored: Funnel passes it through untouched, so any client could pick its own per-address key with it.
//   cloudflare  `CF-Connecting-IP` only, for a named Cloudflare tunnel; `X-Forwarded-For` is ignored.
//   none        no header at all: the socket's own address.
// The default is `caddy`, which is safe for today's Funnel and for VH9's Caddy alike.
// Origin is a browser's claim. A browser always sends it on a WebSocket upgrade, so a page on another site is refused (403); a client with
// no Origin is not a browser (bots, smoke runs, the doctor's Node probes), and could write any Origin it liked, so it is not refused here.

/** Which forwarded header the door believes. */
export type TrustProxy = 'caddy' | 'cloudflare' | 'none';
const MODES: readonly TrustProxy[] = ['caddy', 'cloudflare', 'none'];
export const DEFAULT_TRUST_PROXY: TrustProxy = 'caddy';
/** The pages that open the game (the client's `errorReportOrigins`), when `ALLOWED_ORIGINS` says nothing. */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = ['https://play.wildshard.io', 'https://staging.wildshard.io', 'https://preview.wildshard.io'];

/** What a door is told to trust. `allowedOrigins: null` lets any Origin in (`ALLOWED_ORIGINS=*`). */
export interface DoorTrust { readonly trustProxy: TrustProxy; readonly allowedOrigins: readonly string[] | null }

function origin(text: string): string {
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(`ALLOWED_ORIGINS has ${text}, which is not an origin`); }
  if (url.origin === 'null' || url.origin !== text.replace(/\/$/u, '').toLowerCase()) throw new Error(`ALLOWED_ORIGINS has ${text}, which is not an origin`);
  return url.origin;
}

/** `TRUST_PROXY` and `ALLOWED_ORIGINS` (comma or space separated, or `*`). A word the door doesn't know stops the server. */
export function doorTrust(env: Readonly<Record<string, string | undefined>>): DoorTrust {
  const mode = env['TRUST_PROXY'] === undefined || env['TRUST_PROXY'] === '' ? DEFAULT_TRUST_PROXY : env['TRUST_PROXY'];
  if (!(MODES as readonly string[]).includes(mode)) throw new Error(`TRUST_PROXY is ${mode}; want caddy, cloudflare or none`);
  const listed = (env['ALLOWED_ORIGINS'] ?? '').split(/[\s,]+/u).filter(word => word !== '');
  const allowedOrigins = listed.length === 0 ? DEFAULT_ALLOWED_ORIGINS : listed.includes('*') ? null : listed.map(origin);
  return { trustProxy: mode as TrustProxy, allowedOrigins };
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
type Headers = Readonly<Record<string, string | readonly string[] | undefined>>;

/** The address a connection counts against. Only a loopback peer is a proxy, and only the trusted header is read from it. */
export function trustedAddress(peer: string, headers: Headers, mode: TrustProxy): string {
  if (mode === 'none' || !LOOPBACK.has(peer)) return peer;
  if (mode === 'cloudflare') { const tunnel = headers['cf-connecting-ip']; return typeof tunnel === 'string' ? tunnel.trim() : peer; }
  // Node joins repeated `X-Forwarded-For` lines with ", ", so the last hop is still the one the proxy wrote.
  const forwarded = headers['x-forwarded-for'], hops = typeof forwarded === 'string' ? forwarded.split(',') : [];
  const last = hops.at(-1)?.trim();
  return last === undefined || last === '' ? peer : last;
}

/** A browser's Origin passes only if listed; no Origin is not a browser. */
export function originAllowed(header: string | undefined, allowed: readonly string[] | null): boolean {
  return header === undefined || allowed === null || allowed.includes(header.trim().toLowerCase());
}
