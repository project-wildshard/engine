import type { ChatChannel } from '../../../shared/engine/net/acts';
import { filterWords, MAX_CHAT_BYTES, plainLine } from './chatFilter';

// P1-E5.2c (J110, M5): chat on the server. A line is cleaned and filtered here before anyone hears it, its speaker's flood is
// capped, and the room keeps what was really typed for a while, so a report can show it.

/** How far a proximity line carries, in metres. */
export const CHAT_RADIUS = 30;
/** Lines a speaker may send in a window of ticks: five every five seconds. */
const LINES_PER_WINDOW = 5, WINDOW_TICKS = 300;
/** Reports a player may file in a window. */
const REPORTS_PER_WINDOW = 5;
/** Lines a report can still name. */
const KEPT_LINES = 256;
/** Reporters one line remembers. Past this it has been heard, and more would only cost memory. */
const LINE_REPORTERS = 32;

/** A report of a line, for whoever moderates. It holds what was typed, which no client ever hears filtered away. */
export interface ChatReport { readonly reporter: string; readonly speaker: string; readonly name: string; readonly channel: ChatChannel; readonly typed: string; readonly shown: string; readonly tick: number }
/** Where reports go. Where that ends up is decided later; the room only hands them over. */
export interface ChatReports { file: (report: ChatReport) => void }
/** Who is speaking: their stable id, their Name, and the sim player the room measures distance from. */
export interface ChatSpeaker { readonly player: string; readonly name: string; readonly body: string }
/** MP4.1 (M5): a `room` line on its way to every other cell in the world: who said it, what was typed and what everyone reads.
 *  It was cleaned, filtered and flood-checked where it was said, so a cell that hears it takes it as it is. */
export interface WorldLine { readonly speaker: string; readonly name: string; readonly typed: string; readonly shown: string }
/** The body a line from another cell names: none here, so it reaches every client as nobody they can see (`from` 0). */
const ELSEWHERE = '';
/** A line on its way to the next frame. */
export interface ChatLine { readonly line: number; readonly channel: ChatChannel; readonly body: string; readonly name: string; readonly text: string; readonly tick: number }
interface KeptLine { readonly speaker: string; readonly name: string; readonly channel: ChatChannel; readonly typed: string; readonly shown: string; readonly tick: number; readonly reporters: Set<string> }

/** A player's stamps still inside the window, which the caller adds to. */
function window(stamps: Map<string, number[]>, player: string, tick: number): number[] {
  const held = (stamps.get(player) ?? []).filter(at => tick - at < WINDOW_TICKS);
  stamps.set(player, held);
  return held;
}

/** One room's chat. */
export class RoomChat {
  private readonly reports: ChatReports | undefined;
  private readonly kept = new Map<number, KeptLine>();
  /** Each player's recent lines and reports, as ticks: what a window counts, kept no longer than it. */
  private readonly recent = new Map<string, number[]>();
  private readonly filed = new Map<string, number[]>();
  private sweepAt = 0;
  private readonly pending: ChatLine[] = [];
  private next = 0;
  private readonly shout: ((line: WorldLine) => void) | undefined;
  /** `shout` hears each `room` line said here, for the rest of the world (MP4.1). */
  constructor(reports?: ChatReports, shout?: (line: WorldLine) => void) { this.reports = reports; this.shout = shout; }
  /** Take a line. False if it is empty once cleaned, or the speaker is flooding. */
  say(speaker: ChatSpeaker, channel: ChatChannel, typed: string, tick: number): boolean {
    this.sweep(tick);
    const held = window(this.recent, speaker.player, tick);
    if (held.length >= LINES_PER_WINDOW) return false; // a flood stops before its text costs anything
    const clean = plainLine(typed, MAX_CHAT_BYTES);
    if (clean === '') return false;
    held.push(tick);
    const line = ++this.next, shown = filterWords(clean);
    this.keep(line, { speaker: speaker.player, name: speaker.name, channel, typed: clean, shown, tick, reporters: new Set() });
    this.pending.push({ line, channel, body: speaker.body, name: speaker.name, text: shown, tick });
    if (channel === 'room') this.shout?.({ speaker: speaker.player, name: speaker.name, typed: clean, shown });
    return true;
  }
  /** A `room` line said in another cell (MP4.1). It is kept like one said here, so a report of it still holds what was typed. */
  hear(heard: WorldLine, tick: number): void {
    const line = ++this.next;
    this.keep(line, { speaker: heard.speaker, name: heard.name, channel: 'room', typed: heard.typed, shown: heard.shown, tick, reporters: new Set() });
    this.pending.push({ line, channel: 'room', body: ELSEWHERE, name: heard.name, text: heard.shown, tick });
  }
  private keep(line: number, kept: KeptLine): void {
    this.kept.set(line, kept);
    if (this.kept.size > KEPT_LINES) for (const old of this.kept.keys()) { this.kept.delete(old); break; }
  }
  /** Hand a report of `line` to the port, once per reporter. False if nobody can report it: gone, their own, already theirs, or they are flooding. */
  report(reporter: string, line: number, tick: number): boolean {
    this.sweep(tick);
    const kept = this.kept.get(line), held = window(this.filed, reporter, tick);
    if (kept === undefined || kept.speaker === reporter || kept.reporters.has(reporter) || kept.reporters.size >= LINE_REPORTERS || held.length >= REPORTS_PER_WINDOW) return false;
    held.push(tick); kept.reporters.add(reporter);
    const { reporters: _reporters, ...report } = kept;
    this.reports?.file({ ...report, reporter });
    return true;
  }
  /** Players whose stamps are held: those heard in about the last two windows, however many have ever spoken. */
  get held(): number { return this.recent.size + this.filed.size; }
  /** The lines waiting for this frame. */
  drain(): readonly ChatLine[] { return this.pending.splice(0); }
  /** Forget whoever has gone quiet, a window at a time: a stream of new names costs nothing that lasts. */
  private sweep(tick: number): void {
    if (tick < this.sweepAt) return;
    this.sweepAt = tick + WINDOW_TICKS;
    for (const held of [this.recent, this.filed]) for (const [player, ticks] of held) if (ticks.every(at => tick - at >= WINDOW_TICKS)) held.delete(player);
  }
}
