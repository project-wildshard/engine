// E7.2d (J177, J178): the page half of the one world. It has the shape of `startStandalone`, so `clientWorker.ts` runs the same Game and
// Player against either, but its server is across a socket: the signed release file says which build and which address, the link redials
// by itself, and the world's saves are the server's. This file must never reach a `server`-tagged module (J2).
import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { NetClient } from '@wildshard/engine/net/client';
import { GUEST, type NetIdentity } from '@wildshard/engine/net/identity';
import { Redial, type LinkCause, type LinkProgress, type LinkState } from '@wildshard/engine/net/redial';
import { decodeCountdown, type Countdown } from '@wildshard/engine/net/socketFrames';
import { WebSocketTransport } from '@wildshard/engine/net/webSocketTransport';
import {NetRecords} from '@wildshard/engine/net/netRecord';
import {onlineTelemetry} from '@wildshard/engine/telemetry/runtime';
import type {NetRecord,NetCorrection} from '@wildshard/engine/net/measurements';
import { markUnload } from '@wildshard/engine/boot/lastEnd';
import { dropTabArrival, setTitleArrival } from '@wildshard/engine/boot/titleArrival';
import { chatLines } from './chatLines';
import { VoiceChat, type VoiceHeard, type VoiceLink } from './voice';
import { voiceUi } from './voiceUi';
import { askName } from './nameBox';
import { fetchSignedRelease } from './release';
import { newBuildPanel } from './reconnectStrip';
import { linkScreens } from './linkScreens';

/** `ready` with this byte is a clean quit: the door drops the body at once instead of holding it (server `socketPump.ts` `LEAVE_FLAG`). */
const LEAVE_FLAG = 1;
/** The door's `resume`: the shard this player's seat is in, and since GO3 its grid instance and where in it they stand. */
const ResumeSchema = v.object({ shard: v.string(), cell: v.optional(v.string()), at: v.optional(v.object({ x: v.number(), y: v.number(), z: v.number(), yaw: v.number() })) });
/** Where a seat stands, cell-local. */
export interface SeatPlace { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }

/** What a page says to the world. */
export interface OnlineConfig {
  /** The address the release file names. */
  readonly socket: string;
  /** This page's build: the door refuses another one (J54). */
  readonly build: string;
  /** The cell this page has loaded. */
  readonly loaded: string;
  readonly identity: NetIdentity;
  /** GO4: a grid page. Its seat may be in any cell: the session follows the frames there, so `elsewhere` never reloads it. */
  readonly grid?: true;
  /** Optional anonymous measurements; the page supplies the existing API sink. */
  readonly record?:{readonly install:string;readonly session:string;readonly tag?:string;readonly send:(record:NetRecord)=>void};
}
/** What the link tells the page. */
export interface OnlineView {
  readonly link: (state: LinkState, reason?: string) => void;
  /** J174: a deploy is due, and play goes on. */
  readonly countdown: (countdown: Countdown) => void;
  /** The seat is in a cell this page hasn't loaded. */
  readonly elsewhere: (shard: string) => void;
  /** GO4, GO5: a grid page's seat, by instance, and where in it. */
  readonly placed?: (cell: string, at: SeatPlace | undefined) => void;
}
/** A running online session. */
export interface OnlineShell {
  readonly client: NetClient;
  /** J218: voice chat's signalling, on whichever socket is live. */
  readonly voice: VoiceLink;
  /** Tells a page its link looks after itself: a close is not the end of its server. */
  readonly redials: true;
  /** Resolves when the door has a seat for this player, or a held one comes back. */
  readonly booted: Promise<{ readonly tick: number; readonly restored: boolean }>;
  /** The page has loaded: the door may seat the body (E7.2's step 4). */
  ready: () => void;
  /** The page came back into view: check the link now. */
  visible: () => void;
  retry: () => void;
  /** FM4: the dial's progress and why the link is down, for the screens that show them; dial now, from a hold card. */
  progress: () => LinkProgress;
  dialNow: () => void;
  why: () => LinkCause;
  pause: () => void; resume: () => void; hold: (on: boolean) => void; bossGod: () => void; hardHits: (by: number) => void;
  place: (x: number, y: number, z: number, yaw: number) => void; raise: (flag: string) => void;
  /** QA row 16: the player chose to go (the menu's exit, another world). The body leaves now, not after J114's hold.
   *  Resolves once the door has closed the link; a page waits for it at most `atMostLeaveWait`. */
  leave: () => Promise<void>;
  /** The server keeps a player's saves, so there is nothing to ask for. */
  save: () => Promise<{ readonly tick: number; readonly ok: boolean }>;
  probe: () => Promise<{ readonly tick: number; readonly tickMs: number; readonly rows: readonly never[] }>;
  join: () => never;
  flushRecords:()=>void;
  dispose: () => void;
}

/** The link alone, with no page around it. `startOnline` is this with the strips. */
export function connectOnline(config: OnlineConfig, view: OnlineView): OnlineShell {
  let playtest=false;
  let loaded = false, link: WebSocketTransport | null = null, down = false, unseated: WebSocketTransport | null = null, arrive: (value: { tick: number; restored: boolean }) => void = () => undefined;
  const booted = new Promise<{ tick: number; restored: boolean }>(resolve => { arrive = resolve; });
  const voices = new Set<(word: VoiceHeard) => void>(), encoder = new TextEncoder(), decoder = new TextDecoder();
  const voice: VoiceLink = { send: word => { link?.control('voice', encoder.encode(JSON.stringify(word)).buffer); },
    on: listener => { voices.add(listener); return () => { voices.delete(listener); }; } };
  const hear = (transport: WebSocketTransport): WebSocketTransport => {
    link = transport; down = false;
    transport.onClose(() => { if (link === transport) down = true; });
    transport.onControl((control, bytes) => {
      if(control==='playtest'){playtest=true;return;}
      if (control === 'voice') {
        let word: VoiceHeard;
        try { word = JSON.parse(decoder.decode(bytes)) as VoiceHeard; } catch { return; }
        for (const listener of voices) listener(word);
        return;
      }
      if (control === 'countdown') { const said = decodeCountdown(bytes); if (said !== null) view.countdown(said); return; }
      if (control !== 'resume') return;
      const resume = v.parse(ResumeSchema, JSON.parse(new TextDecoder().decode(bytes))), seat = resume.shard;
      if (config.grid === true) view.placed?.(resume.cell ?? seat, resume.at);
      else if (seat !== config.loaded) { view.elsewhere(seat); return; }
      arrive({ tick: 0, restored: false });
      if (loaded) transport.control('ready'); else unseated = transport;
    });
    return transport;
  };
  const first = hear(new WebSocketTransport(config.socket)), client = new NetClient(first);
  const records=config.record===undefined?undefined:new NetRecords(client,{...config.record,build:config.build,level:config.loaded,
    correction:(row:NetCorrection)=>{if(playtest)link?.control('playtest',new TextEncoder().encode(JSON.stringify(row)).buffer);}});
  const redial = new Redial({ client, transport: first, dial: () => {playtest=false;return hear(new WebSocketTransport(config.socket));}, onState: (state,reason)=>{records?.link(state);view.link(state,reason);}, onCause: cause => { view.link(redial.told, cause); } });
  // A held seat comes straight back with no `resume`: a tab reloaded inside J114's 30 s.
  const offFirst = client.onFrame(() => { offFirst(); arrive({ tick: client.latest?.tick ?? 0, restored: true }); });
  client.hello(config.build, config.identity);
  const tickOf = (): number => client.latest?.tick ?? 0, idle = (): void => undefined;
  return { client, voice, redials: true, booted, ready: () => { loaded = true; unseated?.control('ready'); unseated = null; },
    visible: () => { redial.check(); }, retry: () => { redial.retry(); }, progress: () => redial.progress, why: () => redial.why, dialNow: () => { redial.dialNow(); },
    pause: idle, resume: idle, hold: idle, bossGod: idle, hardHits: idle, place: idle, raise: idle,
    // The door hears a quit on any link of this build: seated, still admitted, or handed a held body back. A link that is down (a redial's
    // wait) gets a fresh one to say it on, so a held body goes too. No redial follows: the page is going.
    leave: () => {
      redial.dispose();
      let quitting = link;
      if (quitting === null || down) { quitting = new WebSocketTransport(config.socket); link = quitting; down = false; client.rejoin(quitting); }
      const gone = new Promise<void>(resolve => { quitting.onClose(() => { resolve(); }); });
      quitting.control('ready', new Uint8Array([LEAVE_FLAG]).buffer);
      return gone;
    },
    save: () => Promise.resolve({ tick: tickOf(), ok: true }), probe: () => Promise.resolve({ tick: tickOf(), tickMs: 0, rows: [] }),
    join: () => { throw new Error('A second client belongs to a server in this page'); },
    flushRecords:()=>{records?.flush();},
    dispose: () => { records?.dispose(); redial.dispose(); client.dispose(); link?.close('disposed'); } };
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
  /** GO4: a grid page, told where its seat stands instead of being reloaded there. */
  readonly grid?: (cell: string, at: SeatPlace) => void;
  /** The signed release file, and the key that signed it. */
  readonly release: string; readonly key: string;
  readonly recordTag?:string;
}
/** E7.5 prep: ask the page to leave for the Connection doctor, saying which screen asked. The page's own bundle answers
 *  (src/client/engine/ui/errorScreen.ts): it holds the save hold and the loading card's report, which this module can't see. */
const doctor = (from: string): void => { document.dispatchEvent(new CustomEvent('ws:doctor', { detail: from })); };

/** Enter the one world this build names. A stale tab reloads into the server's build once, and only then gives up. */
export async function startOnline(config: StartOnline): Promise<OnlineShell> {
  const { release: at, key, identity, recordTag, grid, ...link } = config, release = await fetchSignedRelease(at, key), { socket } = release;
  // QA row 16: a level page enters only from a tap. A reload this page makes itself carries the tap that brought it here.
  const entering = (slug: string): void => { setTitleArrival({ slug, mode: 'enter' }, { tab: true }); };
  const stale = async (): Promise<boolean> => { entering(link.loaded); const going = await reloadStale(); if (!going) dropTabArrival(); return going; };
  if (release.engineBuild !== link.build) await stale();
  if (socket === undefined) throw new Error('The release file names no address');
  const scope = new Scope('online.page');
  const held = identity(), named = held.name === GUEST.name ? identity(await askName(scope, () => { doctor('join'); })) : held;
  let shellNow: OnlineShell | null = null, waitingForSeat = false;
  scope.interval(SEAT_WAIT_BEAT_MS, () => { if (waitingForSeat) seatWaitBeat(); });
  // FM4: the banner, the Reconnected notice, the cards and the hold cards (meta MMO-FAILURE-MODES-PLAN)
  const screens = linkScreens(scope, {
    retry: () => { shellNow?.retry(); }, dialNow: () => { shellNow?.dialNow(); }, doctor,
    // Play here / Play again reload into the world: the tap that brought the player here comes along (QA row 16)
    reload: () => { entering(link.loaded); void reloadByHand(); },
    progress: () => shellNow?.progress() ?? { dials: 0, nextDialMs: null, downMs: 0 }, why: () => shellNow?.why() ?? 'closed',
  });
  // `reload` is the one ending a screen doesn't answer: the page reloads into the world's build, once (J174)
  const ended = async (): Promise<void> => { if (!await stale()) newBuildPanel(scope, stale, () => { entering(link.loaded); void reloadByHand(); }); };
  const telemetry=onlineTelemetry(),tag=recordTag??release.channel;
  const shell = connectOnline({ ...link, ...(grid === undefined ? {} : { grid: true as const }), socket, identity: named,record:{install:telemetry.install,session:crypto.randomUUID(),send:telemetry.send,...(tag===undefined?{}:{tag})} }, {
    link: (state, reason) => { waitingForSeat = state === 'full'; screens.link(state, reason); if (state === 'ended' && reason === 'reload') void ended(); },
    countdown: said => { screens.countdown(said); preload(); },
    placed: (cell, stand) => { if (stand !== undefined) grid?.(cell, stand); },
    elsewhere: seat => { entering(seat); const url = new URL(location.href); url.searchParams.set('chunk', seat); markUnload(`online seat elsewhere (${seat})`); location.replace(url); },
  });
  shellNow = shell;
  // a tap the world must hear waits for the link: the hold card says so, and the tap is never sent late
  shell.client.gateActions(what => screens.allow(what));
  void settled(shell.booted);
  const chat = chatLines(scope, shell.client, document.body, screens.holdChat);
  voiceUi(scope, new VoiceChat(scope, shell.voice), chat);
  scope.listen(window,'pagehide',()=>{shell.flushRecords();});
  scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') { shell.visible(); screens.visible(); } });
  return { ...shell, dispose: () => { scope.dispose(); shell.dispose(); } };
}
