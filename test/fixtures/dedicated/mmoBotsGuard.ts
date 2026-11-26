// MMO-PLAN MP0.4, J205: where bots may go, as one pure check that the bots run first and test/mmo-bots.test.ts runs directly.
// Loopback (a replica) or the staging socket, never production. `forwarded` addresses (one X-Forwarded-For per bot) only on
// loopback: the door trusts that header from its local proxy, so through Funnel it would be a spoof. From one address the door
// seats 4 sockets.

/** The staging channel's socket, as its signed release names it: `rooms-staging` on 443 through Cloudflare (MMO-SERVER MS7). */
export const STAGING_SOCKET = 'wss://rooms-staging.wildshard.io';
/** MS7.3: the one-release Funnel socket fallback has retired. */
export const STAGING_SOCKETS: readonly string[] = [STAGING_SOCKET];
/** NL3's explicit private-route control; never a signed-release fallback. */
export const TAILNET_SOCKET = 'wss://wildshard.tailb41b20.ts.net:8443';
/** MP1.2.d: the box's throwaway replica (`wildshard-config replica`), reached over the tailnet. Its door hands each
 * connection to the replica's loopback (systemd-socket-proxyd), so like a local replica it reads each bot's forwarded address.
 * It is never a channel's server: production and staging listen on loopback 8790 and 8791 only. */
export const BOX_REPLICA_SOCKET = 'ws://wildshard.tailb41b20.ts.net:18796';
/** The door's SOCKETS_PER_IP (src/server/host/dedicated/world.ts). */
export const SOCKETS_PER_ADDRESS = 4;

export interface BotTarget { readonly url: URL; readonly loopback: boolean }

/** MP1.7: spread replica seats evenly and count only their own cell's peers. */
export function botCells(url: string, bots: number, cells: string): readonly { url: string; cell: string | null; peers: number }[] {
  if (cells === '') return Array.from({ length: bots }, () => ({ url, cell: null, peers: bots - 1 }));
  botTarget(url, 'forwarded', bots);
  const names = cells.split(',');
  if (names.length < 2 || names.length > bots || new Set(names).size !== names.length || names.some(name => !/^[a-z0-9-]+$/u.test(name))) throw new Error('Spread needs distinct cell slugs, at least two and at most the bot count');
  const targets = Array.from({ length: bots }, (_, index) => names[index % names.length]);
  return targets.map(cell => {
    if (cell === undefined) throw new Error('Missing spread cell');
    // CHUNK-PARAM CP5 (J522): the socket address stays bare; each bot asks for its cell in its goto word (RoomBot)
    return { url, cell, peers: targets.filter(target => target === cell).length - 1 };
  });
}

/** Throws unless bots may dial `url` with these addresses, this many of them. */
export function botTarget(url: string, addresses: string, bots: number, privateControl = false): BotTarget {
  const parsed = new URL(url);
  const loopback = parsed.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  const boxReplica = parsed.origin === BOX_REPLICA_SOCKET && parsed.pathname === '/' && parsed.search === '' && parsed.hash === '';
  const staging = STAGING_SOCKETS.includes(parsed.origin) && (parsed.pathname === '/' || parsed.pathname === '') && parsed.search === '' && parsed.hash === '';
  const tailnet = privateControl && parsed.origin === TAILNET_SOCKET && parsed.pathname === '/' && parsed.search === '' && parsed.hash === '';
  if (!loopback && !boxReplica && !staging && !tailnet) throw new Error(`J205: bots join loopback or staging only, never ${url}`);
  if (addresses !== 'own' && addresses !== 'forwarded') throw new Error(`Unknown address mode ${addresses}`);
  if (privateControl && !tailnet) throw new Error('Private staging control needs its exact tailnet socket');
  if (addresses === 'forwarded' && !loopback && !boxReplica) throw new Error('Forwarded addresses are for a loopback replica only, or the box replica');
  if (!Number.isInteger(bots) || bots < 1 || bots > 64) throw new Error('Between 1 and 64 bots');
  if (addresses !== 'forwarded' && bots > SOCKETS_PER_ADDRESS) throw new Error(`The door seats at most ${String(SOCKETS_PER_ADDRESS)} sockets from one address`);
  return { url: parsed, loopback };
}
