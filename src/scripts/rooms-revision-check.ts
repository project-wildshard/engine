#!/usr/bin/env node
// SHARD-COMPAT NB2 (J494, Jake 2026-11-22: "the page should always run the server revision"): the release chain's check that page and
// rooms agree for every zone. P1, 2026-11-22: staging's rooms ran Driftwood r9 (an upload moved its cell) while the page baked r8, and
// every enemy was invisible. The door's world word names each cell's upload (`revisions`); for each, the page either baked those bytes
// or can follow them: the cook's index for the page's build and that hash is in the store (`placedContent.ts`). Anything else is a P0.
//   node src/scripts/rooms-revision-check.ts [--channel staging|production]
import { pathToFileURL } from 'node:url';
import { CHANNELS } from './page-release/flow.mjs';
import { agentFetch, markedSocket } from './agent-requests.mjs';

const PACKS = 'https://packs.wildshard.io';
const AGENT = 'rooms-revision-check';
const SOCKET_WORLD = 9;
const HEX = /^[a-f0-9]{64}$/u;

export interface RoomsFinding { readonly scenario: 'rooms-revision'; readonly key: string; readonly severity: 'P0' | 'P1' | 'P2'; readonly text: string; readonly source: 'check' }
type Word = { readonly revisions?: Readonly<Record<string, string>> } | null;

/** The page's build and the shards it baked, from its served `index.html`. */
export function pageBake(html: string): { readonly build: string; readonly baked: ReadonlyMap<string, string> } {
  const build = /__WS_BUILD_ID__\s*=\s*"([^"]+)"/u.exec(html)?.[1];
  const catalogue = /<script[^>]*id="ws-catalogue"[^>]*>([\s\S]*?)<\/script>/u.exec(html)?.[1];
  if (build === undefined || catalogue === undefined) throw new Error('the page names no build or catalogue');
  const shards = (JSON.parse(catalogue) as { shards?: readonly { slug: string; hash: string }[] }).shards ?? [];
  return { build, baked: new Map(shards.map(row => [row.slug.replace(/^_/u, ''), row.hash])) };
}

/** The door's first word (`SOCKET_WORLD` then JSON), or null when it says none in time. */
export function worldWord(socket: string, timeoutMs = 10_000): Promise<Word> {
  return new Promise(resolve => {
    // the Node actor marker (METRICS MT2): `?agent=` and the agent user-agent on the hosted door
    const Socket = markedSocket(WebSocket), ws = new Socket(socket);
    ws.binaryType = 'arraybuffer';
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const done = (value: Word): void => { clearTimeout(timer); try { ws.close(); } catch { /* closed */ } resolve(value); };
    timer = setTimeout(() => { done(null); }, timeoutMs);
    ws.addEventListener('message', event => {
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      if (bytes[0] !== SOCKET_WORLD) return;
      try { done(JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as Word); } catch { done(null); }
    });
    ws.addEventListener('error', () => { done(null); });
    ws.addEventListener('close', () => { done(null); });
  });
}

export interface RoomsCheck {
  readonly origin: string;
  readonly socket: string;
  readonly packs?: string;
  readonly read?: (url: string, init?: RequestInit) => Promise<Response>;
  readonly word?: (socket: string) => Promise<Word>;
}
/** The findings: a P0 for each zone whose rooms run bytes the page neither baked nor can follow; a P2 when the door says nothing
 *  (a busy door answers 429: the check is missing, not failed). */
export async function roomsRevisionFindings({ origin, socket, packs = PACKS, read = agentFetch, word = worldWord }: RoomsCheck): Promise<readonly RoomsFinding[]> {
  const finding = (key: string, severity: RoomsFinding['severity'], text: string): RoomsFinding => ({ scenario: 'rooms-revision', key, severity, text, source: 'check' });
  const page = await read(`${origin}/?agent=${AGENT}`);
  const { build, baked } = pageBake(await page.text());
  const heard = await word(socket);
  if (heard === null) return [finding('no-word', 'P2', `${socket} said no world word`)];
  const out: RoomsFinding[] = [];
  for (const [slug, hash] of Object.entries(heard.revisions ?? {})) {
    const bare = slug.replace(/^_/u, ''), own = baked.get(bare);
    if (!HEX.test(hash) || own === undefined || own === hash) continue;
    const index = await read(`${packs}/index/${build}/${hash}.json`, { method: 'HEAD' });
    if (!index.ok) out.push(finding(`behind-${bare}`, 'P0', `${bare}: the rooms run ${hash.slice(0, 12)}, the page baked ${own.slice(0, 12)} and the cook has no index for build ${build.slice(0, 8)} and those bytes (HTTP ${String(index.status)})`));
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const at = process.argv.indexOf('--channel'), name = at === -1 ? 'staging' : process.argv[at + 1];
  const channel = name === 'staging' ? CHANNELS.staging : name === 'production' ? CHANNELS.production : undefined;
  if (channel === undefined) throw new Error('Usage: node src/scripts/rooms-revision-check.ts [--channel staging|production]');
  const findings = await roomsRevisionFindings({ origin: channel.origin, socket: channel.socket });
  for (const row of findings) console.log(`${row.severity} ${row.key}: ${row.text}`);
  console.log(`rooms-revision ${name}: ${findings.length === 0 ? 'page and rooms agree' : `${String(findings.length)} finding(s)`}`);
  process.exitCode = findings.some(row => row.severity === 'P0') ? 1 : 0;
}
