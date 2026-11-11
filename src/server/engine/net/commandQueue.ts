import * as v from 'valibot';
import { NetCommandSchema, type NetCommand } from '@wildshard/wire/netCommand';
import { NET_PRESSES, seqAfter } from '../../../shared/engine/net/command';

/** Steps a client may run ahead of the clock, so a burst or a late packet costs it nothing. */
export const COMMAND_HEADROOM = 6;
/** Empty ticks a player stands frozen (J125): 250 ms, then it steps with no input, so a stalled client still falls. */
export const STALL_TICKS = 15;
/**
 * The most steps a client can have to spend. The clock pays it one a tick, a step costs one, and past STALL_TICKS the
 * no-input steps spend what an empty client earns: this is what stops a speed-hack by flooding (Unreal's MaxMoveDeltaTime
 * idea, §4.2). A command past it could only run late, so the oldest go.
 */
export const MAX_QUEUED_COMMANDS: number = COMMAND_HEADROOM + STALL_TICKS;
/** Commands waiting past this are more than one client frame's burst (MAX_FIXED_STEPS): the player is behind. */
const BEHIND = 3;

/** One client's part of one tick (J125: commands drive motion, so no command is no motion step). */
export interface CommandTurn {
  /** What the tick's weapons read: the command it steps, or on a tick with none the last one's holds. Null: nothing is held. */
  readonly command: NetCommand | null;
  /** A second step this tick, for a player who is behind. It is only ever motion, so it has no press, swing or shot. */
  readonly extra: NetCommand | null;
  /** The player takes no motion step this tick, and `command` is only what it still holds. */
  readonly still: boolean;
}

/** A command with nothing left in it that could fire twice. */
function holdsOf(command: NetCommand): NetCommand {
  const { attack: _attack, hookTarget: _hook, launcher, ...rest } = command;
  return { ...rest, viewTick: 0, buttons: command.buttons & ~NET_PRESSES, ...(launcher === undefined ? {} : { launcher: { slot: launcher.slot, ads: launcher.ads } }) };
}
/** A command whose wire seq (a u16) is not after `newest`: the queue would drop it whatever the rest of it says. */
function spentSeq(raw: unknown, newest: number): boolean {
  const seq = typeof raw === 'object' && raw !== null ? (raw as { readonly seq?: unknown }).seq : undefined;
  return typeof seq === 'number' && Number.isInteger(seq) && seq >= 0 && seq <= 0xffff && !seqAfter(seq, newest);
}
/** Only a tick's first command reaches the weapon systems, so one that fires anything waits for a tick of its own. */
const motionOnly = (command: NetCommand): boolean => (command.buttons & NET_PRESSES) === 0 && command.attack === undefined && command.launcher?.fire !== true;

/**
 * P1-E5.2 (§4.2), P1-E5.3-C3: one player's server-side input. Every command is admitted, applied once and consumed in order.
 * A server step and a client step are the same step (J125): the queue never invents one, so the server's state at `lastSeq`
 * is the state the client saved for that `seq`, at any frame rate.
 */
export class CommandQueue {
  private readonly queue: NetCommand[] = [];
  private newest: number | null = null;
  private held: NetCommand | null = null;
  private budget = COMMAND_HEADROOM;
  private empty = 0;
  /** The `seq` this player's state reflects, sent back in the owner block. */
  lastSeq = 0;
  /** Commands refused by admission, and copies dropped as duplicates. */
  refused = 0; duplicates = 0;
  /**
   * Queue a decoded bundle, oldest first. A replayed `seq` is dropped, so redundancy cannot repeat a jump. MMO-PLAN MP1.2:
   * every bundle repeats up to REDUNDANT_COMMANDS older commands, so a copy whose seq is already spent is dropped before
   * its schema check (it was checked on arrival), and counts as a duplicate even if the copy itself is malformed.
   */
  admit(commands: readonly NetCommand[]): void {
    for (const raw of commands) {
      if (this.newest !== null && spentSeq(raw, this.newest)) { this.duplicates++; continue; }
      const parsed = v.safeParse(NetCommandSchema, raw);
      if (!parsed.success) { this.refused++; continue; }
      const command = parsed.output;
      if (this.newest !== null && !seqAfter(command.seq, this.newest)) { this.duplicates++; continue; }
      this.newest = command.seq; this.queue.push(command);
    }
    this.trim(MAX_QUEUED_COMMANDS);
  }
  /** This tick's turn: the oldest queued, a second while behind, or nothing to step. */
  next(): CommandTurn {
    this.budget = Math.min(this.budget + 1, MAX_QUEUED_COMMANDS);
    this.trim(this.budget);
    const command = this.take();
    if (command === undefined) return this.starved();
    this.empty = 0;
    const waiting = this.queue[0];
    return { command, extra: waiting !== undefined && this.queue.length > BEHIND && motionOnly(waiting) ? this.take() ?? null : null, still: false };
  }
  private take(): NetCommand | undefined {
    const command = this.queue.shift();
    if (command === undefined) return undefined;
    this.budget--; this.lastSeq = command.seq; this.held = holdsOf(command);
    return command;
  }
  private starved(): CommandTurn {
    this.empty++;
    if (this.empty <= STALL_TICKS) return { command: this.held, extra: null, still: true };
    this.budget--; this.held = null; // a stalled client has let go of everything
    return { command: null, extra: null, still: false };
  }
  private trim(most: number): void { if (this.queue.length > most) this.queue.splice(0, this.queue.length - most); }
}
