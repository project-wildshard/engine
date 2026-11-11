// MMO-PLAN MP0.4, J205: where bots may go, as one pure check that the bots run first and test/mmo-bots.test.ts runs directly.
// Loopback (a replica) or the staging socket, never production. `forwarded` addresses (one X-Forwarded-For per bot) only on
// loopback: the door trusts that header from its local proxy, so through Funnel it would be a spoof. From one address the door
// seats 4 sockets.

/** The staging channel's socket, as its signed release names it: `rooms-staging` on 443 through Cloudflare (MMO-SERVER MS7). */
export const STAGING_SOCKET = 'wss://rooms-staging.wildshard.io';
/** MS7.3: the Funnel's staging socket stays staging for the one release that moves the address; MS8 retires it. */
export const STAGING_SOCKETS: readonly string[] = [STAGING_SOCKET, 'wss://wildshard.tailb41b20.ts.net:8443'];
/** The door's SOCKETS_PER_IP (src/server/host/dedicated/world.ts). */
export const SOCKETS_PER_ADDRESS = 4;

export interface BotTarget { readonly url: URL; readonly loopback: boolean }

/** Throws unless bots may dial `url` with these addresses, this many of them. */
export function botTarget(url: string, addresses: string, bots: number): BotTarget {
  const parsed = new URL(url);
  const loopback = parsed.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  const staging = STAGING_SOCKETS.includes(parsed.origin) && (parsed.pathname === '/' || parsed.pathname === '') && parsed.search === '' && parsed.hash === '';
  if (!loopback && !staging) throw new Error(`J205: bots join loopback or staging only, never ${url}`);
  if (addresses !== 'own' && addresses !== 'forwarded') throw new Error(`Unknown address mode ${addresses}`);
  if (addresses === 'forwarded' && !loopback) throw new Error('Forwarded addresses are for a loopback replica only');
  if (!Number.isInteger(bots) || bots < 1 || bots > 64) throw new Error('Between 1 and 64 bots');
  if (addresses === 'own' && bots > SOCKETS_PER_ADDRESS) throw new Error(`The door seats at most ${String(SOCKETS_PER_ADDRESS)} sockets from one address`);
  return { url: parsed, loopback };
}
