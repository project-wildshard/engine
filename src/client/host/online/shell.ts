// E7.2d (J177, J178): the page half of the one world. It has the shape of `startStandalone`, so `clientWorker.ts` runs the same Game and
// Player against either, but its server is across a socket: the signed release file says which build and which address, the link redials
// by itself, and the world's saves are the server's. This file must never reach a `server`-tagged module (J2).
import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { NetClient } from '@wildshard/engine/net/client';
import type { NetIdentity } from '@wildshard/engine/net/identity';
import { Redial, type LinkCause, type LinkProgress, type LinkState } from '@wildshard/engine/net/redial';
import { decodeArrive, decodeCountdown, decodeEnter, decodeSavesAnswer, encodeEnter, encodeSaves, worldReadsSaves, type ArriveWord, type GotoWord, type Countdown, type RoomSave, type SavesAsk, type WorldWord } from '@wildshard/engine/net/socketFrames';
import { encodeDeviceWord, worldReadsDevice } from '@wildshard/engine/net/deviceWord';
import { encodeStatsWord, STATS_EVERY_MS, worldReadsStats } from '@wildshard/engine/net/statsWord';
import { LinkStats } from '@wildshard/engine/net/linkStats';
import { subscribePersistence, type PersistenceWord } from '@wildshard/engine/net/persistenceWord';
import { WebSocketTransport } from '@wildshard/engine/net/webSocketTransport';
import { gotoFirst } from '@wildshard/engine/net/gotoFirst';
import {NetRecords} from '@wildshard/engine/net/netRecord';
import { pageActor } from '@wildshard/engine/telemetry/pageActor';
import { actorTags } from '@wildshard/engine/app/actor';
import {onlineTelemetry} from '@wildshard/engine/telemetry/runtime';
import type {NetRecord,NetCorrection} from '@wildshard/engine/net/measurements';
import { markUnload } from '@wildshard/engine/boot/lastEnd';
import { dropTabArrival, setTitleArrival } from '@wildshard/engine/boot/titleArrival';
import { chatLines } from './chatLines';
import { VoiceChat, type VoiceHeard, type VoiceLink } from './voice';
import { voiceUi } from './voiceUi';
import { FRESH_WAIT_MS, fetchSignedRelease, freshAfterDial, releaseToDial, type ReleaseKeep } from './release';
import { releaseScreens } from './releaseScreens';
import { beginRelease, takeRelease } from './earlyRelease';
import type { ZoneSelectDocument } from '@wildshard/engine/game/grid/zoneSelectRows';
import { newBuildPanel } from './reconnectStrip';
import { linkScreens } from './linkScreens';
import { saveScreens } from './saveScreens';
import { retentionWatch } from './retentionWatch';
import { tooOldScreens } from './tooOldScreens';
import { holdTitleEntry, type TitleWorld, type WorldHeard } from './titleHold';
import { clearRestart, noteRestart } from '@wildshard/engine/game/grid/worldRestart';
import { fetchCodeRetention } from './codeRetention';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { installBrowserScopeEnvironment } from '@wildshard/engine/app/view/scopeEnvironment';
import { devControls, type DevControls } from './devControl';
import { replaceFresh } from '@wildshard/engine/boot/freshPage';
import { leftByPlayer } from '@wildshard/engine/boot/dropNotice';
import { ROOMS_PING_EVENT, ROOMS_PING_EVERY_MS, roomsPingMs, type RoomsPing } from '@wildshard/engine/net/roomsPing';
import { heardRooms, roomsAheadEnd } from '@wildshard/engine/game/grid/roomsRevision';
import { installedCatalogue } from '@wildshard/engine/game/grid/catalogueSlot';
/** NB2: the slug a grid cell runs, by the page's catalogue (the instance itself when it names none). */
const cellSlug = (cell: string): string => installedCatalogue()?.grid.cells.find(row => row.instance === cell)?.slug ?? cell;

// online.js is a bundle of its own with its own copy of the scope environment, and the page loads it without `identity.js`
// (clientWorker `onlineModule`, oneWayIn `onlineGate`), so its presenters' `scope.raf` (FailureTelemetry measuring a link
// chip) met the bare host's throw: v0.1.32 staging raised the error card on every Unstable connection chip (meta mini QA 86).
installBrowserScopeEnvironment();

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
  /** OF4: the address each later dial takes, when a fresh release file can name another after the first dial. */
  readonly address?: () => string;
  /** CHUNK-PARAM CP5 (J522): the cell each dial asks the door for, in a `goto` word before its hello (`gotoFirst`); none: the kept seat. */
  readonly goto?: () => GotoWord | undefined;
  /** This page's build: the door refuses another one (J54). */
  readonly build: string;
  /** The cell this page has loaded. */
  readonly loaded: string;
  readonly identity: NetIdentity;
  /** GO4: a grid page, and the grid cell (instance) it booted in. A seat elsewhere re-enters the grid there, never a one-shard page. */
  readonly gridCell?: string;
  /** The grid's cells by instance, in frame order (a frame's cell number less one): what a held seat's first frame names. */
  readonly gridCells?: readonly string[];
  /** A one-shard page: the world's cells by shard, in frame order. A held seat whose first frame stands in another shard than
   *  `loaded` goes there, as a `resume` naming it would; its rows never reach this page's creatures (Jake's duneRay, 2026-11-19). */
  readonly shardCells?: readonly string[];
  /** Optional anonymous measurements; the page supplies the existing API sink. */
  readonly record?:{readonly install:string;readonly session:string;readonly tag?:string;readonly send:(record:NetRecord)=>void};
}
/** What the link tells the page. */
export interface OnlineView {
  readonly link: (state: LinkState, reason?: string) => void;
  /** Actual per-client save observations. An older server or a memory store leaves this unknown. FM8s shows them (saveScreens.ts). */
  readonly persistence?: (fact: PersistenceWord) => void;
  /** WR5 (5.5, the cut): a refusal before any frame; the page reloads only if version.json names another build. */
  readonly cut?: (reason: string) => void;
  /** FM5b3: asked before every redial (Redial `mayDial`); false: this page refuses its own reconnect. */
  readonly mayRedial?: () => boolean;
  /** J174: a deploy is due, and play goes on. */
  readonly countdown: (countdown: Countdown) => void;
  /** The seat is in a cell this page hasn't loaded, or (`why`, roomsRevision.ts `roomsAheadEnd`) its rooms run newer bytes of this one. */
  readonly elsewhere: (shard: string, why?: string) => void;
  /** GO4, GO5: a grid page's seat, by instance, and where in it. */
  readonly placed?: (cell: string, at: SeatPlace | undefined) => void;
  /** GO4: a grid page's seat is in a cell it didn't boot: enter the grid again there. */
  readonly regrid?: (cell: string) => void;
  /** GO5: the same, on this page and this link: true when the page enters `cell` in place (the next session takes the link and says
   *  `ready` for the seat the door holds there); false and `regrid` goes on. */
  readonly regridInPage?: (cell: string) => boolean;
}
/** QA-FEEDBACK-2026-11-20-mini row 9: this player's saves in the room, asked on the live link of a door that says it answers. */
export interface RoomSavesPort {
  /** Each shard's save as the room holds it (null: nothing there); null when the door can't say (an older door, the link is down,
   *  no answer in time). */
  read: (shards: readonly string[]) => Promise<Readonly<Record<string, RoomSave | null>> | null>;
  /** New Game on `shard`: true when the door took it (it let the body go and closed the link plainly; it forgets the save before this
   *  player is seated again). False: refused, no such door, or no answer; the save is unchanged and play goes on. */
  reset: (shard: string) => Promise<boolean>;
}
/** Row 9: how long the page waits for the door's answer to a `saves` word. */
const SAVES_ANSWER_MS = 8000;
/** A running online session. */
export interface OnlineShell {
  /** Row 9: the room's copy of this player's saves (`RoomSavesPort`). */
  readonly roomSaves: RoomSavesPort;
  readonly client: NetClient;
  /** J218: voice chat's signalling, on whichever socket is live. */
  readonly voice: VoiceLink;
  /** Tells a page its link looks after itself: a close is not the end of its server. */
  readonly redials: true;
  /** Resolves when the door has a seat for this player, or a held one comes back. */
  readonly booted: Promise<{ readonly tick: number; readonly restored: boolean }>;
  /** The page has loaded: the door may seat the body (E7.2's step 4). */
  ready: () => void;
  /** The page came back into view after `hiddenMs` out of it (FM4b mode 4): check the link now. */
  visible: (hiddenMs?: number) => void;
  retry: () => void;
  /** FM4: the dial's progress and why the link is down, for the screens that show them; dial now, from a hold card. */
  progress: () => LinkProgress;
  dialNow: () => void;
  why: () => LinkCause;
  pause: () => void; resume: () => void; hold: (on: boolean) => void; bossGod: () => void; still: () => void; hardHits: (by: number) => void;
  place: (x: number, y: number, z: number, yaw: number) => void; raise: (flag: string) => void;
  /** MEMORY-STRUCTURE STR4: a DEVSERVER page's dev hook and control channel on a dev server (absent elsewhere). */
  readonly devColliders?: DevControls['devColliders']; readonly devGround?: DevControls['devGround']; readonly devControl?: DevControls;
  /** QA row 16: the player chose to go (the menu's exit, another world). The body leaves now, not after J114's hold.
   *  Resolves once the door has closed the link; a page waits for it at most `atMostLeaveWait`. */
  leave: () => Promise<void>;
  /** The server keeps a player's saves, so there is nothing to ask for. */
  save: () => Promise<{ readonly tick: number; readonly ok: boolean }>;
  probe: () => Promise<{ readonly tick: number; readonly tickMs: number; readonly rows: readonly never[] }>;
  join: () => never;
  flushRecords:()=>void;
  /** ZONE-ENTRY ZE10d2 (J352): a gate's 0. Says `enter` {cell}; the door's `arrive` answers with the pose past the gate (the cell's own
   *  frame), and from then the client holds (the road's frames name the cell being left) until the next welcome. Null: refused, the
   *  link went, or no answer in time; the body plays on at the gate. */
  enter?: (cell: string) => Promise<ArriveWord['at'] | null>;
  /** ZE10d2: the next session on this page takes this link over in `cell` (a grid instance): its `ready` is the door's go. */
  rehome?: (cell: string) => void;
  dispose: () => void;
}
/** ZE10d2: how long a gate's `enter` waits for the door's answer before the page plays on at the gate. */
const ENTER_ANSWER_MS = 10_000;

/** DT3: how long a socket's device word waits for the renderer to name its GPU before it goes without it. */
const DEVICE_GPU_WAIT_MS = 10_000;
/** DT3: this page's device snapshot on `transport` (a closed one drops it). Telemetry: never throws, never holds the link. */
function sendDevice(transport: WebSocketTransport, build: string): void {
  const send = async (): Promise<void> => {
    const { deviceSnapshot } = await import('@wildshard/engine/telemetry/deviceSnapshot');
    transport.control('device', encodeDeviceWord({ ...await deviceSnapshot(DEVICE_GPU_WAIT_MS), build, ...actorTags(pageActor()) }));
  };
  void send().catch(() => undefined);
}

/** The link alone, with no page around it. `startOnline` is this with the strips. */
export function connectOnline(config: OnlineConfig, view: OnlineView): OnlineShell {
  let playtest=false;
  // ZE10d2: the grid cell this link's page is in, moved when the door takes a gate's entry (`arrive`), and the entry until its cell's
  // welcome: a refusal after `arrive` (no `ready` in time, the seat moved) sends the page back to the cell it left
  let gridCell = config.gridCell, entering: { readonly from: string | undefined; readonly to: string } | null = null;
  // set once the client exists (below): the door called a taken entry off
  let callOff: (back: string | undefined) => void = () => undefined;
  const frameOf = (cell: string): number | undefined => { const at = config.gridCells?.indexOf(cell) ?? -1; return at < 0 ? undefined : at + 1; };
  let loaded = false, link: WebSocketTransport | null = null, down = false, unseated: WebSocketTransport | null = null, arrive: (value: { tick: number; restored: boolean }) => void = () => undefined;
  const booted = new Promise<{ tick: number; restored: boolean }>(resolve => { arrive = resolve; });
  const voices = new Set<(word: VoiceHeard) => void>(), encoder = new TextEncoder(), decoder = new TextDecoder();
  // row 9: the links whose door said it answers a `saves` word
  const savesDoors = new WeakSet<WebSocketTransport>();
  // MMO-OBSERVABILITY OB6: the links whose door reads this page's 10 s stats word, and the window it is read from
  const statsDoors = new WeakSet<WebSocketTransport>();
  const linkStats = new LinkStats({ rtt: () => link?.stats.rttMs ?? 0, everyMs: STATS_EVERY_MS,
    send: word => { if (link === null || down || !statsDoors.has(link)) return false; link.control('stats', encodeStatsWord(word)); return true; } });
  let linkState: LinkState = 'live';
  const voice: VoiceLink = { send: word => { link?.control('voice', encoder.encode(JSON.stringify(word)).buffer); },
    on: listener => { voices.add(listener); return () => { voices.delete(listener); }; } };
  const hear = (transport: WebSocketTransport): WebSocketTransport => {
    link = transport; down = false;
    const offPersistence = subscribePersistence(listener => transport.onControl(listener), fact => { view.persistence?.(fact); });
    transport.onClose(offPersistence);
    transport.onClose(() => { if (link === transport) down = true; });
    transport.onControl((control, bytes) => {
      if(control==='playtest'){playtest=true;return;}
      // DEVICE-TELEMETRY DT3: a door whose first word says it reads the device word hears this page's snapshot, once per socket
      if (control === 'world') {
        if (worldReadsDevice(bytes)) sendDevice(transport, config.build); if (worldReadsSaves(bytes)) savesDoors.add(transport);
        if (worldReadsStats(bytes)) statsDoors.add(transport);
        // NB2 (J494): the page runs the rooms' revision of its zone, never its own; it reloads once onto it, or entry refuses
        try { heardRooms(JSON.parse(decoder.decode(bytes)), gridCell === undefined ? config.loaded : cellSlug(gridCell), (zone, hash) => { view.elsewhere(zone, roomsAheadEnd(zone, hash)); }); } catch { /* a word that says no revisions changes nothing */ }
        return;
      }
      if (control === 'voice') {
        let word: VoiceHeard;
        try { word = JSON.parse(decoder.decode(bytes)) as VoiceHeard; } catch { return; }
        for (const listener of voices) listener(word);
        return;
      }
      if (control === 'countdown') { const said = decodeCountdown(bytes); if (said !== null) view.countdown(said); return; }
      if (control === 'enter') { const said = decodeEnter(bytes); if (said?.refused !== undefined && said.cell === entering?.to) callOff(undefined); return; }
      if (control !== 'resume') return;
      const resume = v.parse(ResumeSchema, JSON.parse(new TextDecoder().decode(bytes))), seat = resume.shard;
      if (gridCell !== undefined) {
        const cell = resume.cell ?? seat;
        // The hint is a hint: a write that fails must not hold the seat.
        try { view.placed?.(cell, resume.at); } catch { /* the next resume writes it */ }
        // GO5: a disagreeing hint enters the seat's cell in place where it can; the door waits for that session's `ready`
        if (cell !== gridCell) { if (view.regridInPage?.(cell) !== true) (view.regrid ?? view.elsewhere)(cell); return; }
      } else if (seat !== config.loaded) { view.elsewhere(seat); return; }
      arrive({ tick: 0, restored: false });
      if (loaded) transport.control('ready'); else unseated = transport;
    });
    return transport;
  };
  const first = hear(new WebSocketTransport(config.socket)), client = new NetClient(first);
  // ZE10d2: the door called a taken entry off: the body plays on at the gate, so the page goes back (to `back`, else the cell it left)
  callOff = (back: string | undefined): void => {
    const from = entering?.from;
    entering = null; client.unhold(); gridCell = back ?? from; loaded = true;
    const cell = back ?? from;
    if (cell !== undefined) (view.regrid ?? view.elsewhere)(cell);
  };
  // ZE10d2: a hold that ended in another cell's welcome (a redial thawed back onto the road): back to the cell the body stands in
  client.onHeldElsewhere(frame => { if (entering !== null) callOff(frame === 0 ? undefined : config.gridCells?.[frame - 1]); });
  const records=config.record===undefined?undefined:new NetRecords(client,{...config.record,build:config.build,level:config.loaded,
    correction:(row:NetCorrection)=>{if(playtest)link?.control('playtest',new TextEncoder().encode(JSON.stringify(row)).buffer);}});
  const address = config.address ?? ((): string => config.socket);
  const redial = new Redial({ client, transport: first, dial: () => {playtest=false;return hear(new WebSocketTransport(address()));}, ...view.mayRedial === undefined ? {} : { mayDial: view.mayRedial }, onState: (state,reason)=>{if (linkState === 'live' && (state === 'reconnecting' || state === 'resuming')) linkStats.lostLink(reason ?? 'unknown'); linkState = state;records?.link(state);view.link(state,reason);}, onCause: cause => { view.link(redial.told, cause); }, onCut: reason => { view.cut?.(reason); },
    // row 56: a dial the door has spoken on gets longer to carry its first frame; every link here is a WebSocketTransport (`dial`)
    answered: (transport, heard) => (transport as WebSocketTransport).onControl(() => { heard(); }) });
  // A held seat comes straight back with no `resume`: a tab reloaded inside J114's 30 s.
  // GO4: on a grid page, a held seat in another cell than the page booted re-enters the grid there, as a `resume` would say.
  const offFirst = client.onFrame(() => {
    offFirst();
    const frame = client.latest?.cell, cell = frame === undefined || frame === 0 ? undefined : config.gridCells?.[frame - 1];
    if (gridCell !== undefined && cell !== undefined && cell !== gridCell) { (view.regrid ?? view.elsewhere)(cell); return; }
    const shard = gridCell === undefined && frame !== undefined && frame !== 0 ? config.shardCells?.[frame - 1] : undefined;
    if (shard !== undefined && shard !== config.loaded) { view.elsewhere(shard); return; }
    arrive({ tick: client.latest?.tick ?? 0, restored: true });
  });
  client.sayFirst(gotoFirst(config.goto ?? ((): undefined => undefined)));
  client.hello(config.build, config.identity);
  const tickOf = (): number => client.latest?.tick ?? 0, idle = (): void => undefined;
  // row 9: one `saves` word on the live link and its answer: `pick` reads the answer it waits for, `closed` what a close means
  const askSaves = <T>(word: SavesAsk, pick: (answer: NonNullable<ReturnType<typeof decodeSavesAnswer>>) => T | undefined, closed: T, none: T): Promise<T> => new Promise<T>(resolve => {
    const on = link;
    if (on === null || down || !savesDoors.has(on)) { resolve(none); return; }
    const asking = new Scope('online.saves'), offs: (() => void)[] = [], done = (value: T): void => { for (const off of offs.splice(0)) off(); asking.dispose(); resolve(value); };
    asking.timeout(SAVES_ANSWER_MS, () => { done(none); });
    offs.push(on.onClose(() => { done(closed); }), on.onControl((control, bytes) => {
      if (control !== 'saves') return;
      const said = decodeSavesAnswer(bytes), picked = said === null ? undefined : pick(said);
      if (picked !== undefined) done(picked);
    }));
    on.control('saves', encodeSaves(word));
  });
  const roomSaves: RoomSavesPort = {
    read: shards => askSaves<Readonly<Record<string, RoomSave | null>> | null>({ read: shards }, said => 'read' in said ? said.read : undefined, null, null),
    // the door takes a New Game by closing this link plainly: no redial follows, the page is going (it reloads into the reset save)
    reset: async shard => {
      const taken = await askSaves<boolean>({ reset: shard }, said => 'reset' in said && said.reset === shard ? false : undefined, true, false);
      if (taken) redial.dispose();
      return taken;
    },
  };
  // MEMORY-STRUCTURE STR4: on a dev server, the harness verbs and the dev hook reach its control channel (DEVSERVER pages only)
  const dev = typeof __DEVSERVER__ === 'boolean' && __DEVSERVER__ ? devControls(address, config.identity.player) : null;
  return { client, voice, redials: true, booted, roomSaves, ready: () => { loaded = true; unseated?.control('ready'); unseated = null; },
    visible: hiddenMs => { redial.check(hiddenMs); }, retry: () => { redial.retry(); }, progress: () => redial.progress, why: () => redial.why, dialNow: () => { redial.dialNow(); },
    pause: idle, resume: idle, hold: idle, bossGod: dev?.bossGod ?? idle, still: dev?.still ?? idle, hardHits: dev?.hardHits ?? idle, place: dev?.place ?? idle, raise: dev?.raise ?? idle,
    ...dev === null ? {} : { devColliders: dev.devColliders, devGround: dev.devGround, devControl: dev },
    // The door hears a quit on any link of this build: seated, still admitted, or handed a held body back. A link that is down (a redial's
    // wait) gets a fresh one to say it on, so a held body goes too. No redial follows: the page is going.
    // FL27: a door that heard the quit closes plainly. A link it closed `stalled` was dropped before the quit reached it (it went out
    // in the same turn as the close, before the page heard it), so the quit is said once more on a fresh link.
    leave: () => {
      redial.dispose();
      // QA 11-25 row 85: a leaving page asks for no cell, so its hello goes at once (no `gotoFirst` wait for the door's word) and
      // reaches the door before the quit: a quit ahead of any hello names no seat, so a held body or a line's ticket stayed
      client.sayFirst(null);
      const say = (again: boolean): Promise<void> => {
        let quitting = link;
        // A retry always dials: the link it follows is closed, whether or not `hear` was watching it.
        if (quitting === null || down || !again) { quitting = new WebSocketTransport(address()); link = quitting; down = false; client.rejoin(quitting); }
        const gone = new Promise<void>(resolve => { quitting.onClose(reason => { if (again && reason === 'stalled') void say(false).then(resolve); else resolve(); }); });
        client.helloNow();
        quitting.control('ready', new Uint8Array([LEAVE_FLAG]).buffer);
        return gone;
      };
      return say(true);
    },
    save: () => Promise.resolve({ tick: tickOf(), ok: true }), probe: () => Promise.resolve({ tick: tickOf(), tickMs: 0, rows: [] }),
    join: () => { throw new Error('A second client belongs to a server in this page'); },
    flushRecords:()=>{records?.flush();},
    enter: cell => new Promise<ArriveWord['at'] | null>(resolve => {
      const on = link;
      if (on === null || down) { resolve(null); return; }
      const asking = new Scope('online.enter'), offs: (() => void)[] = [], done = (at: ArriveWord['at'] | null): void => { for (const off of offs.splice(0)) off(); asking.dispose(); resolve(at); };
      asking.timeout(ENTER_ANSWER_MS, () => { done(null); });
      offs.push(on.onClose(() => { done(null); }), on.onControl((control, bytes) => {
        if (control === 'enter' && decodeEnter(bytes)?.cell === cell) { done(null); return; } // the door's `enter` is only ever a refusal
        if (control !== 'arrive') return;
        const said = decodeArrive(bytes);
        if (said === null || said.cell !== cell) return;
        // from here the seat is the cell's: the road's frames name the cell being left, so the next session hears nothing until the
        // cell's welcome, and a redial meanwhile (ZE9c's arrival) asks for the cell and waits for that session's `ready`
        entering = { from: gridCell, to: cell }; gridCell = cell; loaded = false; unseated = null;
        client.hold(frameOf(cell)); done(said.at);
      }));
      on.control('enter', encodeEnter({ cell }));
    }),
    rehome: cell => { gridCell = cell; loaded = false; unseated = down ? null : link; },
    dispose: () => { linkStats.dispose(); records?.dispose(); redial.dispose(); client.dispose(); link?.close('disposed'); } };
}

/** FM3's proof (mode 23, 2026-11-15): how the page leaves this document on purpose. This bundle's saves have no storage (OF4's
 *  `keep`), so the tap it hands the next document (`setTitleArrival`), the unload it marks (`lastEnd`) and the reload claims it
 *  settles were written nowhere: the new-build Reload came back as a "player reload" and landed on the title. The page lends its own
 *  (clientWorker.ts `onlineLeaving`); this module's copies are the fallback for a page that lends none (tests). */
export interface OnlineLeaving {
  /** QA row 16: the tap that brought the player here, for this tab's next document only */
  readonly arrive: (slug: string) => void;
  /** that tap, when the reload it was for didn't happen */
  readonly unarrive: () => void;
  /** the game is about to navigate on purpose (lastEnd) */
  readonly unload: (reason: string) => void;
  /** J54/J174: reload into the server's build, once per tab; false when there is none to reload into, or this tab already did */
  readonly reloadStale: () => Promise<boolean>;
  /** a player's tap on a stale tab: the next document comes from the network */
  readonly reloadByHand: () => Promise<void>;
  /** a seat on this build settles the reload that brought this tab here */
  readonly settle: () => void;
}
const OWN_LEAVING: OnlineLeaving = {
  arrive: slug => { setTitleArrival({ slug, mode: 'enter' }, { tab: true }); }, unarrive: dropTabArrival, unload: reason => { markUnload(reason); },
  reloadStale: async () => (await import('@wildshard/engine/boot/browserChunkRecovery')).reloadRefusedBuild(true),
  reloadByHand: async () => { await (await import('@wildshard/engine/boot/browserChunkRecovery')).reloadPastWorker(); },
  settle: () => { void (async () => { (await import('@wildshard/engine/boot/browserChunkRecovery')).settleRefusedBuild(); })(); },
};
/** A seat on this build settles any reload that brought this tab here, so a sitting can ride more than one deploy. */
async function settled(booted: OnlineShell['booted'], leaving: OnlineLeaving): Promise<void> { await booted; leaving.settle(); }
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
  /** A one-shard page: the world's cells by shard, in frame order (`connectOnline`'s `shardCells`). */
  readonly shardCells?: readonly string[];
  /** Who this device is. A Name given here is kept with its id, and asked only once. */
  readonly identity: (name?: string) => NetIdentity;
  /** GO4: a grid page: the cell it booted in, where its seat stands, and how it enters the grid again in another cell. */
  readonly grid?: { readonly cell: string; readonly cells: readonly string[]; readonly placed: (cell: string, at: SeatPlace) => void; readonly reenter: (cell: string) => void;
    /** GO5: enter the grid again in `cell` on this page, handing this link to the next session, now or once it can (GO5b); `reload`
     *  is GO4's way if it can't. False when this page never enters in place (`reload` is the caller's to run). */
    readonly reenterInPage?: (cell: string, reload: () => void) => boolean;
    /** GO7: Shard select sent this page to `cell`, so every dial asks the door to seat it there (its goto word, `gotoFirst`, CP5). */
    readonly goto?: boolean;
    /** QA 11-19 row 52: a fresh ZONE SELECT pick (no gate's arrival): until the page is first seated, its dials ask for the cell's spawn */
    readonly spawn?: boolean };
  /** The signed release file, and the key that signed it. */
  readonly release: string; readonly key: string;
  /** OF4: where the page keeps the last verified release file. The page's own saves hold it: this bundle's saves have no storage, and
   *  a second store writing the page's device save would drop the keys it doesn't define. */
  readonly keep?: ReleaseKeep;
  readonly recordTag?:string;
  /** mode 23: how the page leaves on purpose, in its own saves (see OnlineLeaving) */
  readonly leaving?: OnlineLeaving;
  /** FM8b mode 27: the page's sign-in (the page's bundle lends it); absent, the world never speaks of one. */
  readonly session?: OnlineSession;
}
/** FM8b mode 27: the page's sign-in, as the online shell needs it. The page's bundle lends it: this one holds no saves. */
export interface OnlineSession {
  /** Ask the account service for a fresh join ticket: `ok`, `ended` (its 401: the page is signed out), `guest` (no session here), or
   *  `unknown` (no answer, so nothing is claimed). */
  readonly renew: () => Promise<'ok' | 'ended' | 'guest' | 'unknown'>;
  /** Hear the session end, however the page found out (the 20-minute refresh, a renew); at once if it already had. */
  readonly onEnded: (heard: () => void) => void;
  /** The existing sign-in card over the world; true when the page is signed in once it closes. */
  readonly signIn: () => Promise<boolean>;
}
/** E7.5 prep: ask the page to leave for the Connection doctor, saying which screen asked. The page's own bundle answers
 *  (src/client/engine/ui/errorScreen.ts): it holds the save hold and the loading card's report, which this module can't see. */
const doctor = (from: string): void => { document.dispatchEvent(new CustomEvent('ws:doctor', { detail: from })); };

/** FM4b modes 5 to 8: how long the game's own site gets to answer. */
const SITE_ANSWER_MS = 5000;
/** FM4b modes 5 to 8: does this page's own origin answer a fresh read now? Any HTTP status is an answer; no reply in time is none. */
async function siteAnswers(scope: Scope): Promise<boolean> {
  const asking = scope.child('online.site'), abort = new AbortController();
  asking.timeout(SITE_ANSWER_MS, () => { abort.abort(); });
  try { await fetch(new URL('/version.json', location.origin), { cache: 'no-store', signal: abort.signal }); return true; } catch { return false; } finally { asking.dispose(); }
}

/** This page's read of each release's word: under way, or done (`done` when). */
const asking = new Map<string, { word: Promise<unknown>; done: number | null }>();
/** How long a page answers from a read that heard nothing before it dials again. */
const SILENT_KEEP_MS = 10_000;
/** opus-wordkeep: the word a page heard, which release and when. */
export interface KeptWord { readonly of: string; readonly at: number; readonly word: unknown }
/** Where a page keeps the word it heard. This bundle's save store has no storage (OF4), so a keep here would die with the page: the
 *  page lends its own (`oneWayIn.ts`, its `gridGate` session save). */
export interface WordKeep { readonly read: () => KeptWord | null; readonly write: (kept: KeptWord) => void }
/** A caller that lends no keep keeps the word for this module realm only. */
let realmWord: KeptWord | null = null;
const REALM_WORD: WordKeep = { read: () => realmWord, write: kept => { realmWord = kept; } };
/** GO4 gate: whether the world this build names hosts the grid, by `hosts` on the door's word (`worldWord`). Any failure answers false.
 *  No page picks its server by it any more (OFFLINE OF2: a world build's pages all go online). A word is kept a minute, a no as well as a yes, so a `WORLD_CELLS` change reaches a tab
 *  within that minute. */
export async function worldHostsGrid(config: { readonly release: string; readonly key: string }, hosts: (world: unknown) => boolean, waitMs = 3000, keep: WordKeep = REALM_WORD): Promise<boolean> {
  const word = await worldWord(config, waitMs, keep);
  try { return word !== null && hosts(word); } catch { return false; }
}
/** GO4, opus-route2: the door's first word (`world`: its cell count and the shard each cell runs), or null when none came in `waitMs`.
 *  The release names the address; a socket there hears the word and closes before any hello, so no seat is taken. Not `/health`: D7
 *  keeps that off the rooms address (a 404 with no CORS), and only loopback answers it. */
export async function worldWord(config: { readonly release: string; readonly key: string }, waitMs = 3000, keep: WordKeep = REALM_WORD): Promise<unknown> {
  // The title, a zone's world page, the grid page and a one-shard page each ask within seconds, and every socket counts against the door's
  // 10 a minute per address: a tab keeps the word it heard for a minute, in the page's keep (`keep`, opus-wordkeep). No word is asked
  // again on the next page, since a stall or a blip says nothing; within one page, a read under way or one that just heard nothing
  // answers the next, so a page waits once.
  const kept = keptWord(keep, config.release);
  if (kept !== null) return kept;
  const asked = asking.get(config.release);
  if (asked !== undefined && (asked.done === null || Math.abs(Date.now() - asked.done) < SILENT_KEEP_MS)) return asked.word;
  const read: { word: Promise<unknown>; done: number | null } = { word: askWorld(config, waitMs), done: null };
  asking.set(config.release, read);
  const word = await read.word;
  read.done = Date.now();
  if (word !== null) { try { keep.write({ of: config.release, at: Date.now(), word }); } catch { /* a page that can keep nothing asks again */ } }
  return word;
}
/** Use the signed world address for its channel's public Zone Select read. */
export async function zoneSelectLocation(config: { readonly release: string; readonly key: string }, deadline: number):
Promise<{ readonly url: string; readonly channel: ZoneSelectDocument['channel'] } | null> {
  const { socket, channel } = await fetchSignedRelease(config.release, config.key, deadline);
  if (socket === undefined) return null;
  const at = new URL(socket);
  if (at.protocol === 'wss:') at.protocol = 'https:';
  else if (at.protocol === 'ws:') at.protocol = 'http:';
  else return null;
  return { url: new URL('/zone-select', at).href, channel };
}

const GATE_KEEP_MS = 60_000;
/** A page that lends no keep reads the release file every time. */
const NO_KEEP: ReleaseKeep = { read: () => null, write: () => undefined };
function keptWord(keep: WordKeep, release: string): unknown {
  try {
    const kept = keep.read();
    return kept !== null && kept.of === release && Math.abs(Date.now() - kept.at) < GATE_KEEP_MS ? kept.word ?? null : null;
  } catch { return null; }
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

/** FM4 9b/10b: what the title's own socket heard, for `titleHold.ts`. */
async function heardWorld(world: TitleWorld): Promise<WorldHeard> {
  const word = await askWorld(world, 3000);
  if (typeof word !== 'object' || word === null) return { heard: false };
  const moving = (word as WorldWord).moving?.inS;
  return { heard: true, movingInS: typeof moving === 'number' && Number.isFinite(moving) ? moving : null };
}
/** FM4 9b/10b: Enter world from the title enters now, or holds on `restart-blocked` / `deploy-blocked` until the world is back. */
export async function titleEnter(world: TitleWorld, go: () => void): Promise<void> { await holdTitleEntry(world, go, heardWorld); }

/** Enter the one world this build names. A stale tab reloads into the server's build once, and only then gives up. */
/** ZE10d2: a page's online session that the next session on the same page can take over after a gate's `enter` (`adopt`). */
export interface StartedOnline extends OnlineShell {
  /** The next session's slug and grid: the seat's cell, its place hint and re-entry are the new session's, and its `ready` the door's go. */
  readonly adopt: (next: { readonly loaded: string; readonly grid: NonNullable<StartOnline['grid']> }) => void;
}
/** OF4: a verified kept release file dials at once (offline too), and the fresh read follows; with none, the page waits for the read.
 *  FM5: with no kept copy and no file, the page says why (offline, the file's server down or busy, a portal, a bad signature) and
 *  reads again by release.ts's policy until a verified file answers; Title screen stops the load. */
function readRelease(at: string, key: string, keep: ReleaseKeep, leaving: OnlineLeaving): ReturnType<typeof releaseToDial> {
  const waiting = new Scope('online.release-wait');
  const toTitle = (): void => { leftByPlayer('release page: title screen'); leaving.unload('release page: title screen'); replaceFresh('/'); };
  // SB44: a page that can read waits FRESH_WAIT_MS for the fresh file behind a kept copy, so another build reloads it before play
  const freshWait = typeof navigator === 'undefined' || navigator.onLine ? { freshWaitMs: FRESH_WAIT_MS, timer: (ms: number) => new Promise<void>(resolve => { waiting.timeout(ms, resolve); }) } : {};
  return releaseToDial(at, key, { keep, wait: releaseScreens(waiting, { doctor, title: toTitle }), ...freshWait }).finally(() => { waiting.dispose(); });
}
/** TEMPLATE-E2E TR-4b (T1 K): a world build reads its release file from the boot's data step (clientWorker.ts), so a missing
 *  file shows its page within seconds of the tap, beside the load, not after it; `startOnline` takes the read over. */
export function readReleaseEarly(config: { readonly release: string; readonly key: string; readonly keep?: ReleaseKeep; readonly leaving?: OnlineLeaving }): void {
  beginRelease(config.release, () => readRelease(config.release, config.key, config.keep ?? NO_KEEP, config.leaving ?? OWN_LEAVING));
}
export async function startOnline(config: StartOnline): Promise<StartedOnline> {
  const { release: at, key, keep, identity, recordTag, grid, leaving = OWN_LEAVING, session, ...link } = config;
  // ZE10d2: a gate's adoption moves the page's slug, grid and goto to the cell entered (a redial then asks for that cell).
  // NB2: a one-shard page asks for its own shard on every dial, so a fresh title pick moves a seat held in another cell (GO7)
  // and the page and the seat agree; a door that doesn't host the shard seats it as before, and the page follows (duneRay).
  let loadedNow = link.loaded, gridNow = grid, goto = grid === undefined ? link.loaded : grid.goto === true ? grid.cell : undefined, spawn = grid?.goto === true && grid.spawn === true;
  // J501: every caller is a Title screen tap on a card that already said what failed (and reported it): the player's own exit
  const toTitle = (from = 'release page'): void => { leftByPlayer(`${from}: title screen`); leaving.unload(`${from}: title screen`); replaceFresh('/'); };
  const dial = await takeRelease(at, () => readRelease(at, key, keep ?? NO_KEEP, leaving));
  const { file: release, fresh } = dial, { socket } = release;
  // QA row 16: a level page enters only from a tap. A reload this page makes itself carries the tap that brought it here.
  const entering = (slug: string): void => { leaving.arrive(slug); };
  const stale = async (): Promise<boolean> => { entering(loadedNow); const going = await leaving.reloadStale(); if (!going) leaving.unarrive(); return going; };
  // only a fresh read says the world moved on: a kept copy's build is the past, and an offline page can't reload anyway
  // SB44: a page reloading into the world's build is going: it never dials, so its world never reaches play on the build it leaves
  if (fresh === null && release.engineBuild !== link.build && await stale()) await new Promise<never>(() => { /* settles never: the page reloads */ });
  if (socket === undefined) throw new Error('The release file names no address');
  const scope = new Scope('online.page');
  // QA-FEEDBACK 11-19 row 37 (Jake): no STAGING badge on any screen; the version chip says which build this is
  let dialing = socket;
  // MP2.4: the page asked for the Name before it got here (namePrompt.ts, once per device); Skip keeps the device's own (Guest)
  const named = identity();
  let shellNow: OnlineShell | null = null, waitingForSeat = false, recheck = (): void => undefined, wasDown = false;
  scope.interval(SEAT_WAIT_BEAT_MS, () => { if (waitingForSeat) seatWaitBeat(); });
  // FM4: the banner, the Reconnected notice, the cards and the hold cards (meta MMO-FAILURE-MODES-PLAN)
  const screens = linkScreens(scope, {
    retry: () => { shellNow?.retry(); }, dialNow: () => { shellNow?.dialNow(); }, doctor,
    // Play here / Play again reload into the world: the tap that brought the player here comes along (QA row 16)
    reload: () => { entering(loadedNow); void leaving.reloadByHand(); }, title: (why = 'removed (banned)') => { toTitle(why); },
    // FM8b mode 27: Sign in is the existing card, and a page signed in when it closes rejoins as the account; Play as a guest rejoins
    // as the device (the page is already signed out). Both are this page's own reload into the world, the tap coming along.
    ...session === undefined ? {} : {
      signIn: () => { void session.signIn().then(yes => { if (yes) { entering(loadedNow); void leaving.reloadByHand(); } return undefined; }); },
      guest: () => { entering(loadedNow); void leaving.reloadByHand(); },
    },
    // FM7b2: Title from a full world's line says the clean quit first (the door drops the ticket), for at most 3 s
    leaveLine: () => { void Promise.race([shellNow?.leave() ?? Promise.resolve(), new Promise<void>(resolve => { scope.timeout(3000, resolve); })]).then(() => { toTitle('left a full world\'s line'); return undefined; }); },
    progress: () => shellNow?.progress() ?? { dials: 0, nextDialMs: null, downMs: 0 }, why: () => shellNow?.why() ?? 'closed',
    // FM4b modes 21 and 22: the Slow and Unstable chips read the link's own measurements
    stats: () => shellNow?.client.stats,
    // FM4b modes 5 to 8: whether the game's own site answers (any HTTP reply is an answer), and the signed release file read again
    reach: () => siteAnswers(scope), recheck: () => { recheck(); },
  });
  // FM8b mode 27: the account service's own word that the session ended opens the signed-out card
  session?.onEnded(() => { screens.signedOut(); });
  // FM8s: the server's own save facts (late, failing) and the hold on Leave the world while a save isn't confirmed
  const saves = saveScreens(scope);
  // FM5b: is this page's own code still carried (signed /code-retention.json against a fresh release, at boot and on each update
  // poll)? Retired: a banner in play, and the too-old page at the next zone entry, reconnect or before the first seat
  let seated = false;
  const tooOld = tooOldScreens(scope, { update: () => { entering(loadedNow); void leaving.reloadByHand(); } });
  const retention = retentionWatch(scope, { build: link.build, release: () => fetchSignedRelease(at, key), retention: expected => fetchCodeRetention(key, expected),
    changed: view => { tooOld.retention(view); if (!seated && tooOld.refuse('boot')) void shellNow?.leave(); } });
  void retention.check();
  scope.listen(window, 'ws-live-build', () => { void retention.check(); });
  // QA-FEEDBACK 11-24 row 36: the live link's round trip, once a second, for the page's Developer ping chip (ui/pingChip.ts)
  let linkLive = false;
  scope.interval(ROOMS_PING_EVERY_MS, () => {
    const detail: RoomsPing = { rttMs: roomsPingMs(shellNow?.client.stats.rttMs, linkLive) };
    document.dispatchEvent(new CustomEvent(ROOMS_PING_EVENT, { detail }));
  });
  // `reload` is the one ending a screen doesn't answer: the page reloads into the world's build, once (J174)
  const ended = async (): Promise<void> => { if (!await stale()) newBuildPanel(scope, stale, () => { entering(loadedNow); void leaving.reloadByHand(); }); };
  const telemetry=onlineTelemetry(),tag=recordTag??release.channel;
  // GO4: a grid page re-enters the grid in the seat's cell: the tap that brought it here comes along (QA row 16), and the URL stays bare.
  const regrid = (cell: string): void => { entering(loadedNow); leaving.unload(`online seat in another grid cell (${cell})`); gridNow?.reenter(cell); };
  const shell = connectOnline({ ...link, ...(grid === undefined ? {} : { gridCell: grid.cell, gridCells: grid.cells }), socket, address: () => dialing, goto: () => (goto === undefined ? undefined : { cell: goto, spawn }), identity: named,record:{install:telemetry.install,session:crypto.randomUUID(),send:telemetry.send,...(tag===undefined?{}:{tag})} }, {
    link: (state, reason) => {
      waitingForSeat = state === 'full'; screens.link(state, reason); saves.link(state === 'live'); tooOld.link(state === 'live');
      // FM8b mode 27: each drop asks the account service for a fresh ticket before the redial needs it, so a session that ended is
      // heard now (its 401 opens the card), not at the next 20-minute refresh. The door's own `auth-expired` close (FM7b3c: the ticket
      // ran out) asks too: a session that still holds rejoins with the fresh ticket, and only an ended one keeps the card.
      if (state === 'ended' && reason === 'refused' && shellNow?.progress().ended?.code === 'auth-expired') {
        void session?.renew().then(said => { if (said === 'ok') { entering(loadedNow); void leaving.reloadByHand(); } return undefined; });
      } else if (state !== 'live' && !wasDown) void session?.renew();
      wasDown = state !== 'live';
      linkLive = state === 'live';
      // FM5b3: a refused reconnect (mayRedial, before its dial: a quick one shows no banner) ends the link; the body leaves, so nobody
      // stands in the world behind the page
      if (state === 'ended' && reason === 'retired') void shellNow?.leave();
      // FM4 9b: a restart this tab heard explains a quiet world to the title's Enter world; a live link ends it
      if (state === 'live') clearRestart(); else if (shellNow?.why() === 'restart') noteRestart();
      if (state === 'ended' && reason === 'reload') void ended();
    },
    persistence: fact => { saves.fact(fact); },
    mayRedial: () => !(seated && tooOld.refuse('reconnect')),
    // The cut (5.5): an old server refused a v1 hello. Reload only into another build; on this one, the server is updating.
    cut: () => { void leaving.reloadStale(); },
    countdown: said => { screens.countdown(said); preload(); },
    placed: (cell, stand) => { if (stand !== undefined) gridNow?.placed(cell, stand); },
    regrid: cell => { regrid(cell); },
    regridInPage: cell => gridNow?.reenterInPage?.(cell, () => { regrid(cell); }) === true,
    // CHUNK-PARAM CP3 (J522): the seat's zone rides in the tab (`entering`'s tap), never the address
    elsewhere: (seat, why) => { entering(seat); leaving.unload(why ?? `online seat elsewhere (${seat})`); replaceFresh(new URL(location.href)); },
  });
  shellNow = shell;
  // the fresh read behind a kept copy: another build reloads into it, as a fresh read before the dial would (two reloads share one
  // durable claim, chunkRecovery.ts); another address takes the next dial: now if the link is down and waiting, else after the dial
  // under way, or the player's Retry once the link has given up
  const takeRead = (read: Awaited<ReturnType<typeof fetchSignedRelease>> | null): unknown => {
    if (read === null || scope.disposed) return undefined;
    // SB44: a world that already seated this page keeps it; the newer build waits for the next visit (no reload out of play)
    if (read.engineBuild !== link.build) return freshAfterDial(read, link.build, seated) === 'reload' ? stale() : undefined;
    if (read.socket !== undefined && read.socket !== dialing) { dialing = read.socket; shell.dialNow(); }
    return undefined;
  };
  void fresh?.then(takeRead);
  // FM4b modes 5 to 8: a page that can't reach the world reads its signed release file again (one read at a time): a new address
  // takes the next dial, another build reloads as a fresh read would. A read that fails changes nothing.
  let rechecking = false;
  recheck = () => {
    if (rechecking || scope.disposed) return;
    rechecking = true;
    void fetchSignedRelease(at, key).then(takeRead, () => undefined).finally(() => { rechecking = false; });
  };
  // a tap the world must hear waits for the link: the hold card says so, and the tap is never sent late
  shell.client.gateActions(what => screens.allow(what));
  void settled(shell.booted, leaving);
  // QA 11-19 row 52: seated once, a redial comes back where the player stands
  void shell.booted.then(() => { seated = true; spawn = false; return undefined; });
  const chat = chatLines(scope, shell.client, document.body, screens.holdChat);
  voiceUi(scope, new VoiceChat(scope, shell.voice), chat);
  scope.listen(window,'pagehide',()=>{shell.flushRecords();});
  // FM4b mode 4: how long the page was out of view rides the check, so a long absence back to a quiet link opens Welcome back
  let hiddenAt: number | null = document.visibilityState === 'hidden' ? diagnosticNow() : null;
  scope.listen(document, 'visibilitychange', () => {
    if (document.visibilityState !== 'visible') { hiddenAt ??= diagnosticNow(); return; }
    const hiddenMs = hiddenAt === null ? 0 : diagnosticNow() - hiddenAt;
    hiddenAt = null; shell.visible(hiddenMs); screens.visible();
  });
  return { ...shell, dispose: () => { scope.dispose(); shell.dispose(); },
    // ZE10d2: from the door's `arrive` every dial asks for the cell entered (ZE9c seats a redial in the hold there)
    enter: async cell => { if (tooOld.refuse('zone')) return null; const pose = await shell.enter?.(cell) ?? null; if (pose !== null) { goto = cell; spawn = false; } return pose; },
    adopt: next => { loadedNow = next.loaded; gridNow = next.grid; goto = next.grid.cell; spawn = false; shell.rehome?.(next.grid.cell); } };
}
