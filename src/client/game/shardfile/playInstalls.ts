// SHARD-SOURCE SS-GP7: one install list for a one-shard page and a grid data cell. A play feature used to be installed twice,
// once in the shardfile client (`client.ts`) and once per grid stay (`grid/dataCell*.ts`), and every feature added to one
// side alone was a grid gap (GRID-CELL-PARITY). Each feature here is one entry: `wants` reads the source, `install` reads
// only its port. The page walks the list once with its own wire; a grid stay walks it with the wire gated on the cell being
// the wire's site, its systems named for the cell. `grid/play-installs.test.ts` fails for an entry the grid port leaves idle.
import type { Object3D } from 'three';
import type { ItemRuntime } from '@wildshard/engine/combat/items';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { FollowedMovers } from '../plugin/followedMovers';
import { installSteerRide, type SteerRider, type SteerRideView } from '../plugin/steerRide';
import type { SteerRow } from '../plugin/steerPrediction';
import type { PlayerWireInput } from '@wildshard/engine/player/Player';
import { localWalkingMove } from '@wildshard/engine/player/walk';
import { installDeclaredTalks, type TalkBox } from './declaredTalks';
import { itemLineMirror } from './itemLines';
import { installRaceClock, type RaceClockView } from './raceClock';
import { wirePage } from './wirePage';

/** The page views an entry draws with, made on first use: the page's chips and box, or a test's. */
export interface PlayViews { readonly raceClock: () => RaceClockView; readonly steer: () => SteerRideView; readonly talkBox: () => TalkBox }

/** The wire as one side reads it: the page's always, a grid stay's only while the wire is its cell's. */
export interface PlayWire {
  /** One of this player's owned lines; 0 when the server has said none (or the wire is another cell's). */
  readonly line: (name: string) => number;
  readonly tick: () => number | null;
  readonly led: () => boolean;
  readonly send: (id: string) => void;
  /** Whether the wire is bound and this side's. */
  readonly live: () => boolean;
  /** SS-MS2a3b: a mover's row in the newest frame (its sample of that tick), or null. */
  readonly moverRow: (id: string) => SteerRow | null;
  /** Commands this page sent that the server has not stepped yet. */
  readonly behind: () => number;
}

/** Everything a play entry reads off its side. */
export interface PlayPort extends PlayWire {
  readonly scope: Scope;
  readonly system: (spec: SystemSpec) => void;
  /** This player's flags as the server last said them. */
  readonly flags: { has: (flag: string) => boolean };
  /** The side's prompts: a talk's joins them. */
  readonly prompts: Interactable[];
  /** Where an entry's own figures hang (a talk's stand-in). */
  readonly root: Object3D;
  /** The player's feet. */
  readonly feet: () => { readonly x: number; readonly z: number };
  readonly rider: SteerRider;
  /** Whether the rider holds boost (sprint) now. */
  readonly boost: () => boolean;
  /** The world move the player's held stick and view make now (SS-MS2a3b: a steer vehicle's stick on this page). */
  readonly move: () => { readonly x: number; readonly z: number };
  /** The side's followed movers, or null when it built none. */
  readonly movers: FollowedMovers | null;
  /** The held kit's items, or null while there is none (a grid kit comes and goes with its own stay). */
  readonly items: () => ReadonlyMap<string, ItemRuntime> | null;
  readonly views: PlayViews;
  /** The page's debug handle; a grid stay has none. */
  readonly expose?: (name: string, value: object) => void;
}

/** One play feature, installed the same way on both sides. */
export interface PlayInstall {
  readonly id: string;
  readonly wants: (source: Shardfile) => boolean;
  readonly install: (source: Shardfile, port: PlayPort) => void;
}

/** The wire reads and sends of one side. `here` says whether the wire is this side's (always, on a one-shard page). */
export function playWire(here: () => boolean = () => true): PlayWire {
  return { line: (name) => (here() ? wirePage.line(name) : 0), tick: () => (here() ? wirePage.tick() : null), led: () => here() && wirePage.led(),
    send: (id) => { if (here()) wirePage.send(id); }, live: () => wirePage.client !== null && here(),
    moverRow: (id) => (here() ? wirePage.moverRow(id) : null), behind: () => (here() ? wirePage.pending() : 0) };
}

/** The world move a player's held controls make now, as the walk (and the server, off the command) reads them. */
export function heldMove(player: { sampleHeldCommand: () => PlayerWireInput }): () => { readonly x: number; readonly z: number } {
  const out = { x: 0, z: 0 };
  return () => { const held = player.sampleHeldCommand(); localWalkingMove(held.steer, held.yaw, out); return { x: out.x, z: out.z }; };
}

/** Whether a source declares any race. */
export const hasRaces = (source: Pick<Shardfile, 'quests'>): boolean => (source.quests.races?.length ?? 0) > 0;
/** Whether a source declares any talk. */
export const hasTalks = (source: Pick<Shardfile, 'targets'>): boolean => (source.targets.talks?.length ?? 0) > 0;
/** Whether a source's movers hold a steer vehicle to ride. */
export const hasSteerRides = (source: Pick<Shardfile, 'movers'>): boolean => source.movers.some(row => row.carry !== undefined && row.driver?.kind === 'steer');
/** Whether a source projects a player field onto a held item (a lantern's fuel or light). */
export const hasItemLines = (source: Pick<Shardfile, 'targets'>): boolean => (source.targets.itemFields ?? []).length > 0;

/** SS-MS1a3 / SS-MS1b: a declared race's clock, off this player's race lines. */
const races: PlayInstall = { id: 'races', wants: hasRaces, install: (source, port) => {
  installRaceClock(source.quests.races ?? [], { system: port.system, line: port.line, tick: port.tick, view: port.views.raceClock() });
} };

/** TE-ENG3 / TC-E8: a quest-giver from rows. The server keeps each player's node and says it as an owned line. */
const talks: PlayInstall = { id: 'talks', wants: hasTalks, install: (source, port) => {
  let box: TalkBox | null = null;
  const installed = installDeclaredTalks(source, { root: port.root, scope: port.scope, interactables: port.prompts, system: port.system, flags: port.flags,
    line: port.line, send: port.send, box: () => { box ??= port.views.talkBox(); return box; }, player: port.feet });
  port.expose?.('shardfileTalks', { talks: () => installed.map(talk => ({ id: talk.id, node: talk.node() ?? null, open: box?.isOpen ?? false })) });
} };

/** SS-MS2a3 / SS-MS2a3b: a steer vehicle's rider: its leave prompt, the view behind its heading, its speed and boost. */
const rides: PlayInstall = { id: 'rides', wants: hasSteerRides, install: (_source, port) => {
  const movers = port.movers;
  if (movers === null) return;
  installSteerRide(movers, { system: port.system, led: port.led, player: port.rider, view: port.views.steer(), boost: port.boost,
    predict: { move: port.move, row: port.moverRow, behind: port.behind } });
  port.scope.onDispose(() => { movers.steered = null; }); // the next install boards afresh
} };

/** SR11 (C9) / 0601e1ac: the server burns the lantern; its owned lines are what the held tool shows. */
const itemLines: PlayInstall = { id: 'item-lines', wants: hasItemLines, install: (source, port) => {
  let seen: ReadonlyMap<string, ItemRuntime> | null = null, mirror: (() => void) | null = null;
  port.system({ id: 'shardfile.item-lines', phase: 'update', run: () => {
    const runtimes = port.items();
    if (runtimes !== seen) { seen = runtimes; mirror = runtimes === null ? null : itemLineMirror(source, runtimes, port.line); }
    if (mirror !== null && port.live()) mirror();
  } });
} };

/** Every play feature both sides install. A new one goes here, never in `client.ts` or a grid stay alone. */
export const PLAY_INSTALLS: readonly PlayInstall[] = [races, talks, rides, itemLines];

/** Install every entry `source` wants on `port`; the ids installed. */
export function installPlay(source: Shardfile, port: PlayPort, list: readonly PlayInstall[] = PLAY_INSTALLS): string[] {
  return list.flatMap(entry => {
    if (!entry.wants(source)) return [];
    entry.install(source, port);
    return [entry.id];
  });
}
