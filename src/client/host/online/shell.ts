// E7.2d (J177, J178): the page half of the one world. It has the shape of `startStandalone`, so `clientWorker.ts` runs the same Game and
// Player against either, but its server is across a socket: the signed release file says which build and which address, the link redials
// by itself, and the world's saves are the server's. This file must never reach a `server`-tagged module (J2).
import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { NetClient } from '@wildshard/engine/net/client';
import type { NetIdentity } from '@wildshard/engine/net/identity';
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
import { jsonSlot, type Json } from '@wildshard/engine/saves/slots';
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
  /** GO4: a grid page, and the grid cell (instance) it booted in. A seat elsewhere re-enters the grid there, never a `?chunk=` page. */
  readonly gridCell?: string;
  /** The grid's cells by instance, in frame order (a frame's cell number less one): what a held seat's first frame names. */
  readonly gridCells?: readonly string[];
  /** Optional anonymous measurements; the page supplies the existing API sink. */
  readonly record?:{readonly install:string;readonly session:string;readonly tag?:string;readonly send:(record:NetRecord)=>void};
}
/** What the link tells the page. */
export interface OnlineView {
  readonly link: (state: LinkState, reason?: string) => void;
  /** WR5 (5.5, the cut): a refusal before any frame; the page reloads only if version.json names another build. */
  readonly cut?: (reason: string) => void;
  /** J174: a deploy is due, and play goes on. */
  readonly countdown: (countdown: Countdown) => void;
  /** The seat is in a cell this page hasn't loaded. */
  readonly elsewhere: (shard: string) => void;
  /** GO4, GO5: a grid page's seat, by instance, and where in it. */
  readonly placed?: (cell: string, at: SeatPlace | undefined) => void;
  /** GO4: a grid page's seat is in a cell it didn't boot: enter the grid again there. */
  readonly regrid?: (cell: string) => void;
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
      if (config.gridCell !== undefined) {
        const cell = resume.cell ?? seat;
        // The hint is a hint: a write that fails must not hold the seat.
        try { view.placed?.(cell, resume.at); } catch { /* the next resume writes it */ }
        if (cell !== config.gridCell) { (view.regrid ?? view.elsewhere)(cell); return; }
      } else if (seat !== config.loaded) { view.elsewhere(seat); return; }
      arrive({ tick: 0, restored: false });
      if (loaded) transport.control('ready'); else unseated = transport;
    });
    return transport;
  };
  const first = hear(new WebSocketTransport(config.socket)), client = new NetClient(first);
  const records=config.record===undefined?undefined:new NetRecords(client,{...config.record,build:config.build,level:config.loaded,
    correction:(row:NetCorrection)=>{if(playtest)link?.control('playtest',new TextEncoder().encode(JSON.stringify(row)).buffer);}});
  const redial = new Redial({ client, transport: first, dial: () => {playtest=false;return hear(new WebSocketTransport(config.socket));}, onState: (state,reason)=>{records?.link(state);view.link(state,reason);}, onCause: cause => { view.link(redial.told, cause); }, onCut: reason => { view.cut?.(reason); } });
  // A held seat comes straight back with no `resume`: a tab reloaded inside J114's 30 s.
  // GO4: on a grid page, a held seat in another cell than the page booted re-enters the grid there, as a `resume` would say.
  const offFirst = client.onFrame(() => {
    offFirst();
    const frame = client.latest?.cell, cell = frame === undefined || frame === 0 ? undefined : config.gridCells?.[frame - 1];
    if (config.gridCell !== undefined && cell !== undefined && cell !== config.gridCell) { (view.regrid ?? view.elsewhere)(cell); return; }
    arrive({ tick: client.latest?.tick ?? 0, restored: true });
  });
  client.hello(config.build, config.identity);
  const tickOf = (): number => client.latest?.tick ?? 0, idle = (): void => undefined;
  return { client, voice, redials: true, booted, ready: () => { loaded = true; unseated?.control('ready'); unseated = null; },
    visible: () => { redial.check(); }, retry: () => { redial.retry(); }, progress: () => redial.progress, why: () => redial.why, dialNow: () => { redial.dialNow(); },
    pause: idle, resume: idle, hold: idle, bossGod: idle, hardHits: idle, place: idle, raise: idle,
    // The door hears a quit on any link of this build: seated, still admitted, or handed a held body back. A link that is down (a redial's
    // wait) gets a fresh one to say it on, so a held body goes too. No redial follows: the page is going.
    // FL27: a door that heard the quit closes plainly. A link it closed `stalled` was dropped before the quit reached it (it went out
    // in the same turn as the close, before the page heard it), so the quit is said once more on a fresh link.
    leave: () => {
      redial.dispose();
      const say = (again: boolean): Promise<void> => {
        let quitting = link;
        // A retry always dials: the link it follows is closed, whether or not `hear` was watching it.
        if (quitting === null || down || !again) { quitting = new WebSocketTransport(config.socket); link = quitting; down = false; client.rejoin(quitting); }
        const gone = new Promise<void>(resolve => { quitting.onClose(reason => { if (again && reason === 'stalled') void say(false).then(resolve); else resolve(); }); });
        quitting.control('ready', new Uint8Array([LEAVE_FLAG]).buffer);
        return gone;
      };
      return say(true);
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
  /** GO4: a grid page: the cell it booted in, where its seat stands, and how it enters the grid again in another cell. */
  readonly grid?: { readonly cell: string; readonly cells: readonly string[]; readonly placed: (cell: string, at: SeatPlace) => void; readonly reenter: (cell: string) => void;
    /** GO7: Shard select sent this page to `cell`, so every dial asks the door to seat it there (`gotoSocket`). */
    readonly goto?: boolean };
  /** The signed release file, and the key that signed it. */
  readonly release: string; readonly key: string;
  readonly recordTag?:string;
}
/** E7.5 prep: ask the page to leave for the Connection doctor, saying which screen asked. The page's own bundle answers
 *  (src/client/engine/ui/errorScreen.ts): it holds the save hold and the loading card's report, which this module can't see. */
const doctor = (from: string): void => { document.dispatchEvent(new CustomEvent('ws:doctor', { detail: from })); };

/** GO7: the address a page dials. A page Shard select sent to a grid cell names it (`?chunk=`, the shard page's own name for where it
 *  enters, ZS5), and the door seats it there when it
 *  hosts that cell; any other page dials the bare address and takes the seat the world keeps (GO5). An older door ignores the query. */
export function gotoSocket(socket: string, cell: string | undefined): string {
  if (cell === undefined) return socket;
  const url = new URL(socket); url.searchParams.set('chunk', cell);
  return url.href;
}

/** This page's read of each release's word: under way, or done (`done` when). */
const asking = new Map<string, { word: Promise<unknown>; done: number | null }>();
/** How long a page answers from a read that heard nothing before it dials again. */
const SILENT_KEEP_MS = 10_000;
/** GO4 gate: whether the world this build names hosts the grid, by `hosts` on the door's word (`worldWord`). Any failure answers false,
 *  and the grid page keeps today's solo grid. A word is kept a minute, a no as well as a yes, so a `WORLD_CELLS` change reaches a tab
 *  within that minute. */
export async function worldHostsGrid(config: { readonly release: string; readonly key: string }, hosts: (world: unknown) => boolean, waitMs = 3000): Promise<boolean> {
  const word = await worldWord(config, waitMs);
  try { return word !== null && hosts(word); } catch { return false; }
}
/** GO4, opus-route2: the door's first word (`world`: its cell count and the shard each cell runs), or null when none came in `waitMs`.
 *  The release names the address; a socket there hears the word and closes before any hello, so no seat is taken. Not `/health`: D7
 *  keeps that off the rooms address (a 404 with no CORS), and only loopback answers it. */
export async function worldWord(config: { readonly release: string; readonly key: string }, waitMs = 3000): Promise<unknown> {
  // The title, a `?chunk=` page, the grid page and a one-shard page each ask within seconds, and every socket counts against the door's
  // 10 a minute per address: a tab keeps the word it heard for a minute. No word is asked again on the next page, since a stall or a
  // blip says nothing; within one page, a read under way or one that just heard nothing answers the next, so a page waits once.
  const kept = keptWord(config.release);
  if (kept !== null) return kept;
  const asked = asking.get(config.release);
  if (asked !== undefined && (asked.done === null || Math.abs(Date.now() - asked.done) < SILENT_KEEP_MS)) return asked.word;
  const read: { word: Promise<unknown>; done: number | null } = { word: askWorld(config, waitMs), done: null };
  asking.set(config.release, read);
  const word = await read.word;
  read.done = Date.now();
  if (word !== null) keepWord(config.release, word);
  return word;
}
const GATE_KEEP_MS = 60_000;
/** The tab's kept word (a session save), made on first use so a page that never asks defines nothing. The release is under `of`, not
 *  `release`: an older build in the same tab kept only a yes there and reads any fresh `release` entry as one. */
const gateSlot = (): ReturnType<typeof jsonSlot> => jsonSlot('gridGate', 'session');
function keptWord(release: string): unknown {
  try {
    const kept = gateSlot().read();
    const fresh = typeof kept === 'object' && kept !== null && !Array.isArray(kept) && kept['of'] === release && typeof kept['at'] === 'number' && Math.abs(Date.now() - kept['at']) < GATE_KEEP_MS;
    return fresh ? kept['word'] ?? null : null;
  } catch { return null; }
}
/** A word is parsed JSON, so it keeps as it came. */
function keepWord(release: string, word: unknown): void {
  try { gateSlot().write({ of: release, at: Date.now(), word: word as Json }); } catch { /* a page that can keep nothing asks again */ }
}
async function askWorld(config: { readonly release: string; readonly key: string }, waitMs: number): Promise<unknown> {
  // One deadline over the release file and the socket: a stall in either must not hold the page.
  const scope = new Scope('online.grid-gate'), late = new Promise<null>(resolve => { scope.timeout(waitMs, () => { resolve(null); }); });
  const asked: { transport?: WebSocketTransport } = {};
  const read = (async (): Promise<unknown> => {
    const { socket } = await fetchSignedRelease(config.release, config.key);
    if (socket === undefined || scope.disposed) return null;
    const transport = new WebSocketTransport(socket);
    asked.transport = transport;
    return new Promise<unknown>(resolve => {
      transport.onClose(() => { resolve(null); });
      transport.onControl((control, bytes) => {
        if (control !== 'world') return;
        try { resolve(JSON.parse(new TextDecoder().decode(bytes)) as unknown); } catch { resolve(null); }
      });
    });
  })().catch(() => null);
  try { return await Promise.race([read, late]); } finally { scope.dispose(); asked.transport?.close(); }
}

/** Enter the one world this build names. A stale tab reloads into the server's build once, and only then gives up. */
export async function startOnline(config: StartOnline): Promise<OnlineShell> {
  const { release: at, key, identity, recordTag, grid, ...link } = config, release = await fetchSignedRelease(at, key), { socket } = release;
  // QA row 16: a level page enters only from a tap. A reload this page makes itself carries the tap that brought it here.
  const entering = (slug: string): void => { setTitleArrival({ slug, mode: 'enter' }, { tab: true }); };
  const stale = async (): Promise<boolean> => { entering(link.loaded); const going = await reloadStale(); if (!going) dropTabArrival(); return going; };
  if (release.engineBuild !== link.build) await stale();
  if (socket === undefined) throw new Error('The release file names no address');
  const scope = new Scope('online.page');
  // MP2.4: the page asked for the Name before it got here (namePrompt.ts, once per device); Skip keeps the device's own (Guest)
  const named = identity();
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
  const shell = connectOnline({ ...link, ...(grid === undefined ? {} : { gridCell: grid.cell, gridCells: grid.cells }), socket: gotoSocket(socket, grid?.goto === true ? grid.cell : undefined), identity: named,record:{install:telemetry.install,session:crypto.randomUUID(),send:telemetry.send,...(tag===undefined?{}:{tag})} }, {
    link: (state, reason) => { waitingForSeat = state === 'full'; screens.link(state, reason); if (state === 'ended' && reason === 'reload') void ended(); },
    // The cut (5.5): an old server refused a v1 hello. Reload only into another build; on this one, the server is updating.
    cut: () => { void reloadStale(); },
    countdown: said => { screens.countdown(said); preload(); },
    placed: (cell, stand) => { if (stand !== undefined) grid?.placed(cell, stand); },
    // A grid page re-enters the grid in the seat's cell: the tap that brought it here comes along (QA row 16), and the URL stays bare.
    regrid: cell => { entering(link.loaded); markUnload(`online seat in another grid cell (${cell})`); grid?.reenter(cell); },
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
