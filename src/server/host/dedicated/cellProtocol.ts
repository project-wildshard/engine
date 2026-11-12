import type { ChatReport, WorldLine } from '@wildshard/engine/net/chat';
import type { PlayerDoc } from './playerDoc';
import type { SaveReceipt, SaveWrite } from './saves/saveStore';
import type {PlaytestHit} from './playtest';

// J182: what the door and a cell worker say to each other. Sockets stay with the door, and a seat's bytes go through its own port.

/** J114: how long a dropped player's body stands. */
export const HOLD_MS = 30_000;
/** Where a client must load. */
export interface ResumeAt { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }
/** The previous durable copy and grants it still needs, tried only if the current copy cannot import. */
export interface SavedCheckpoint { readonly doc: PlayerDoc; readonly recovery: readonly SaveReceipt[] }
/** A seat the door has cleared: who, and their save. */
export interface SeatEntry {
  readonly device: string; readonly name: string; readonly body: string;
  readonly doc: PlayerDoc | null; readonly seq: number;
  /** Durable grants absent from a recovered document; reconcile before seating. */
  readonly recovery?: readonly SaveReceipt[];
  readonly previous?: SavedCheckpoint;
  /** The door found this device's seat held, so read no save for it: if the hold has run out since, this client must dial again. */
  readonly held?: boolean;
}
/** What the door says to a worker. */
export type CellOrder =
  | { readonly kind: 'find'; readonly id: number; readonly slug: string; readonly device: string }
  | ({ readonly kind: 'seat'; readonly slug: string; readonly port: MessagePort; readonly hello: ArrayBuffer } & SeatEntry)
  | { readonly kind: 'drain' }
  /** MP4.1: a `room` line said in cell `from`, for every other awake cell on this worker. */
  | { readonly kind: 'chat'; readonly from: string; readonly line: WorldLine }
  /** GC15: a seat in cell `from` walks into `to` on the same worker. The entry is the door's read of their save on `to`'s shard. */
  | ({ readonly kind: 'cross'; readonly from: string; readonly to: string; readonly at: ResumeAt } & SeatEntry)
  | { readonly kind: 'close' };
/** One 10 s reading of a worker (E7.8). */
export interface WorkerReading {
  readonly cells: number; readonly awake: number;
  readonly players: number; readonly held: number; readonly ticks: number; readonly ticksPerSecond: number;
  readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number; readonly drops: number;
  readonly rss: number; readonly heap: number; readonly refused: number; readonly dropped: number; readonly frameBytes: number; readonly eventBytes: number;
}
/** What a cell tells the worker it runs on. */
export type RoomNews =
  | {readonly kind:'playtest';readonly row:PlaytestHit}
  | { readonly kind: 'left'; readonly device: string; readonly seats: number }
  | { readonly kind: 'seated'; readonly device: string; readonly body: string; readonly seats: number }
  | { readonly kind: 'refused'; readonly device: string; readonly reason: string }
  | { readonly kind: 'recovered'; readonly device: string; readonly seq: number }
  | { readonly kind: 'save'; readonly write: SaveWrite }
  /** MP4.1: a `room` line said here, for the rest of the world. */
  | { readonly kind: 'chat'; readonly line: WorldLine }
  /** GC15: this seat's feet left for cell `to`, standing at `at` in its frame: the door reads their save there and orders the `cross`. */
  | { readonly kind: 'crossing'; readonly device: string; readonly to: string; readonly at: ResumeAt };
/** What a worker says to the door. */
export type WorkerNews =
  | { readonly kind: 'booted'; readonly ms: number }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'found'; readonly id: number; readonly held: boolean; readonly spawn: ResumeAt }
  | { readonly kind: 'report'; readonly slug: string; readonly report: ChatReport }
  | { readonly kind: 'reading'; readonly reading: WorkerReading }
  | { readonly kind: 'cell'; readonly slug: string; readonly ms: number }
  | { readonly kind: 'drained' }
  /** GC15: a `cross` order's end. Moved, the seat and its link are in `to` and `from` has let it go; else it stands in `from` still. */
  | { readonly kind: 'crossed'; readonly device: string; readonly name: string; readonly from: string; readonly to: string; readonly moved: boolean }
  | (RoomNews & { readonly slug: string });
