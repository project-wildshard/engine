// E7.2d (J177, J178): the page half of the one world. It has the shape of `startStandalone`, so `clientWorker.ts` runs the same Game and
// Player against either, but its server is across a socket: the signed release file says which build and which address, the link redials
// by itself, and the world's saves are the server's. This file must never reach a `server`-tagged module (J2).
import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { NetClient } from '@wildshard/engine/net/client';
import { GUEST, type NetIdentity } from '@wildshard/engine/net/identity';
import { Redial, type LinkState } from '@wildshard/engine/net/redial';
import { decodeCountdown, type Countdown } from '@wildshard/engine/net/socketFrames';
import { WebSocketTransport } from '@wildshard/engine/net/webSocketTransport';
import { chatLines } from './chatLines';
import { askName } from './nameBox';
import { fetchSignedRelease } from './release';
import { countdownStrip, newBuildPanel, reconnectStrip } from './reconnectStrip';

/** The door's `resume`: the cell this player's seat is in. */
const ResumeSchema = v.object({ shard: v.string() });

/** What a page says to the world. */
export interface OnlineConfig {
  /** The address the release file names. */
  readonly socket: string;
  /** This page's build: the door refuses another one (J54). */
  readonly build: string;
  /** The cell this page has loaded. */
  readonly loaded: string;
  readonly identity: NetIdentity;
}
/** What the link tells the page. */
export interface OnlineView {
  readonly link: (state: LinkState, reason?: string) => void;
  /** J174: a deploy is due, and play goes on. */
  readonly countdown: (countdown: Countdown) => void;
  /** The seat is in a cell this page hasn't loaded. */
  readonly elsewhere: (shard: string) => void;
}
/** A running online session. */
export interface OnlineShell {
  readonly client: NetClient;
  /** Tells a page its link looks after itself: a close is not the end of its server. */
  readonly redials: true;
  /** Resolves when the door has a seat for this player, or a held one comes back. */
  readonly booted: Promise<{ readonly tick: number; readonly restored: boolean }>;
  /** The page has loaded: the door may seat the body (E7.2's step 4). */
  ready: () => void;
  /** The page came back into view: check the link now. */
  visible: () => void;
  retry: () => void;
  pause: () => void; resume: () => void; hold: (on: boolean) => void; bossGod: () => void; hardHits: (by: number) => void;
  place: (x: number, y: number, z: number, yaw: number) => void; raise: (flag: string) => void;
  /** The server keeps a player's saves, so there is nothing to ask for. */
  save: () => Promise<{ readonly tick: number; readonly ok: boolean }>;
  probe: () => Promise<{ readonly tick: number; readonly tickMs: number; readonly rows: readonly never[] }>;
  join: () => never;
  dispose: () => void;
}

/** The link alone, with no page around it. `startOnline` is this with the strips. */
export function connectOnline(config: OnlineConfig, view: OnlineView): OnlineShell {
  let loaded = false, link: WebSocketTransport | null = null, unseated: WebSocketTransport | null = null, arrive: (value: { tick: number; restored: boolean }) => void = () => undefined;
  const booted = new Promise<{ tick: number; restored: boolean }>(resolve => { arrive = resolve; });
  const hear = (transport: WebSocketTransport): WebSocketTransport => {
    link = transport;
    transport.onControl((control, bytes) => {
      if (control === 'countdown') { const said = decodeCountdown(bytes); if (said !== null) view.countdown(said); return; }
      if (control !== 'resume') return;
      const seat = v.parse(ResumeSchema, JSON.parse(new TextDecoder().decode(bytes))).shard;
      if (seat !== config.loaded) { view.elsewhere(seat); return; }
      arrive({ tick: 0, restored: false });
      if (loaded) transport.control('ready'); else unseated = transport;
    });
    return transport;
  };
  const first = hear(new WebSocketTransport(config.socket)), client = new NetClient(first);
  const redial = new Redial({ client, transport: first, dial: () => hear(new WebSocketTransport(config.socket)), onState: view.link });
  // A held seat comes straight back with no `resume`: a tab reloaded inside J114's 30 s.
  const offFirst = client.onFrame(() => { offFirst(); arrive({ tick: client.latest?.tick ?? 0, restored: true }); });
  client.hello(config.build, config.identity);
  const tickOf = (): number => client.latest?.tick ?? 0, idle = (): void => undefined;
  return { client, redials: true, booted, ready: () => { loaded = true; unseated?.control('ready'); unseated = null; },
    visible: () => { redial.check(); }, retry: () => { redial.retry(); },
    pause: idle, resume: idle, hold: idle, bossGod: idle, hardHits: idle, place: idle, raise: idle,
    save: () => Promise.resolve({ tick: tickOf(), ok: true }), probe: () => Promise.resolve({ tick: tickOf(), tickMs: 0, rows: [] }),
    join: () => { throw new Error('A second client belongs to a server in this page'); },
    dispose: () => { redial.dispose(); client.dispose(); link?.close('disposed'); } };
}

const reloadStale = async (): Promise<boolean> => (await import('@wildshard/engine/boot/browserChunkRecovery')).reloadRefusedBuild(true);
const reloadByHand = async (): Promise<void> => { await (await import('@wildshard/engine/boot/browserChunkRecovery')).reloadPastWorker(); };
/** A seat on this build settles any reload that brought this tab here, so a sitting can ride more than one deploy. */
async function settled(booted: OnlineShell['booted']): Promise<void> { await booted; (await import('@wildshard/engine/boot/browserChunkRecovery')).settleRefusedBuild(); }
/** J174: the next build's files, while play goes on. The worker that installs is what the reload lands on. */
function preload(): void {
  if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistration().then(found => found?.update()).catch(() => undefined);
}

const SEAT_WAIT_BEAT_MS = 5000;
/** J178: a page told the world is full waits for as long as its player does, and the loading card's stall watch hears each beat of it. */
function seatWaitBeat(): void {
  const card = document.querySelector<HTMLElement>('.ws-load');
  if (card !== null) card.dataset['seatWait'] = String(Date.now());
}

/** What the page lends the online shell: its build's world, as the document was stamped (`WILDSHARD_RELEASE_URL`). */
export interface StartOnline {
  readonly loaded: string; readonly build: string;
  /** Who this device is. A Name given here is kept with its id, and asked only once. */
  readonly identity: (name?: string) => NetIdentity;
  /** The signed release file, and the key that signed it. */
  readonly release: string; readonly key: string;
  readonly failed: (message: string) => void;
}

/** Enter the one world this build names. A stale tab reloads into the server's build once, and only then gives up. */
export async function startOnline(config: StartOnline): Promise<OnlineShell> {
  const { failed, release: at, key, identity, ...link } = config, release = await fetchSignedRelease(at, key), { socket } = release;
  if (release.engineBuild !== link.build) await reloadStale();
  if (socket === undefined) throw new Error('The release file names no address');
  const scope = new Scope('online.page');
  const held = identity(), named = held.name === GUEST.name ? identity(await askName(scope)) : held;
  let retry = (): void => undefined, waitingForSeat = false;
  scope.interval(SEAT_WAIT_BEAT_MS, () => { if (waitingForSeat) seatWaitBeat(); });
  const showLink = reconnectStrip(scope, () => { retry(); }), showCountdown = countdownStrip(scope);
  const ended = async (reason: string | undefined): Promise<void> => {
    if (reason !== 'reload') { failed(reason === 'replaced' ? 'This world is open in another tab.' : `The server closed this link (${String(reason)}).`); return; }
    if (!await reloadStale()) newBuildPanel(scope, reloadStale, () => { void reloadByHand(); });
  };
  const shell = connectOnline({ ...link, socket, identity: named }, {
    link: (state, reason) => { waitingForSeat = state === 'full'; showLink(state); if (state === 'ended') void ended(reason); },
    countdown: said => { showCountdown(said); preload(); },
    elsewhere: seat => { const url = new URL(location.href); url.searchParams.set('chunk', seat); location.replace(url); },
  });
  retry = shell.retry;
  void settled(shell.booted);
  chatLines(scope, shell.client);
  scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') shell.visible(); });
  return { ...shell, dispose: () => { scope.dispose(); shell.dispose(); } };
}
