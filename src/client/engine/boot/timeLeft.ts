/**
 * LS5 (J188): the loading card's time left, from the Load rows' measured weights and this device's measured speed.
 *
 * A calibrated path measures every row twice (src/client/game/boot/loadingPaths.ts): `weight`, its seconds on the phone
 * stand-in (Chromium on a real GPU at 4x CPU and a throttled network, the bar's share, LS7), and `fastWeight`, its
 * seconds on an unthrottled desktop GPU. Rows do not slow down alike between the two (Home region is 4x slower, the
 * program links barely change), so one speed ratio cannot carry a fast device's rows. Each finished row is a reading of
 * where this device sits between the two profiles; a least-squares fit of those readings gives that place, and every
 * row still to run costs its fast seconds plus that share of its difference. A running row that has already overrun its
 * cost is a reading too: it raises the fit, so the estimate goes up rather than holding a number already wrong. A row's
 * own reported share is not used: rows report their cheap units first (Home region reads 97 % within its first second,
 * the first frame 30 % in a tenth of its time) or last (Worker boot sits at a sixth until its final 0.2 s), so it is
 * the bar's real progress, not a clock.
 *
 * Nothing here is a timer or a guess. Until a second of the phone profile's work has finished, there is no reading, and
 * the estimate is `null`: the card hides it (Jake's call 3, 2026-11-07: "only once enough real readings make it honest").
 */
import { engineString } from '../../../shared/engine/strings';

export interface TimeLeftRow {
  readonly key: string; readonly state: 'todo' | 'on' | 'ok'; readonly ms: number;
  /** Phone-profile seconds; absent means the path's default share of 1, which is not a measurement. */
  readonly weight?: number;
  /** Desktop-profile seconds; absent means the path is not measured on two profiles. */
  readonly fastWeight?: number;
}

/** Finished phone-profile seconds before this device's speed is a reading. */
export const TIME_LEFT_MIN_READ_SECONDS = 1;
/** Rows below this many phone-profile seconds are too short to read a speed from (their ms is mostly scheduling). */
const MIN_ROW_SECONDS = 0.05;
/** `modules`' row starts at the document, so its ms repeats Start; `finish` is the parent that stays open until ready. */
const NOT_LOAD_WORK = new Set(['modules', 'finish']);

/** Seconds left in the Load rows, or `null` when the readings do not support a number yet. */
export function timeLeftSeconds(rows: readonly TimeLeftRow[]): number | null {
  if (rows.length === 0 || rows.some(row => row.fastWeight === undefined || !Number.isFinite(row.fastWeight) || row.weight !== undefined && !Number.isFinite(row.weight))) return null;
  const slow = (row: TimeLeftRow): number => Math.max(0, row.weight ?? 1), fast = (row: TimeLeftRow): number => Math.max(0, row.fastWeight ?? 0);
  const work = rows.filter(row => !NOT_LOAD_WORK.has(row.key));
  let dd = 0, dy = 0, read = 0;
  const reading = (row: TimeLeftRow): void => {
    const d = slow(row) - fast(row);
    dd += d * d; dy += d * (Math.max(0, row.ms) / 1000 - fast(row));
  };
  for (const row of work) if (row.state === 'ok' && slow(row) >= MIN_ROW_SECONDS) { reading(row); read += slow(row); }
  if (read < TIME_LEFT_MIN_READ_SECONDS || dd <= 0) return null;
  const fitted = dy / dd;
  const cost = (row: TimeLeftRow, place: number): number => Math.max(0, fast(row) + place * (slow(row) - fast(row)));
  // A running row past its cost is a lower bound on its own reading: add it, and keep the higher place.
  for (const row of work) if (row.state === 'on' && slow(row) >= MIN_ROW_SECONDS && row.ms / 1000 > cost(row, fitted)) reading(row);
  const place = Math.max(fitted, dy / dd);
  let left = 0;
  for (const row of work) {
    if (row.state === 'todo') left += cost(row, place);
    else if (row.state === 'on') left += Math.max(0, cost(row, place) - row.ms / 1000);
  }
  return left;
}

/** How fast the shown finish follows a new reading (seconds of time constant). */
const FOLLOW_SECONDS = 0.6;
/** A shown number rises only once the estimate is a whole second past it, so a reading near x.5 cannot flicker x / x+1:
 *  the risen number then stands at least half a second before the countdown takes it back down. */
const RISE_SECONDS = 1;

/**
 * The card's number: a projected finish time that follows each reading smoothly, shown in whole seconds that count down
 * with the clock. It may go up when the readings say so; it never flickers. `null` hides it.
 */
export class TimeLeftClock {
  private finishAt = Number.NaN;
  private at = Number.NaN;
  private shownSeconds = 0;

  /** `now` in ms; `seconds` the latest estimate, or `null` to hide. */
  read(now: number, seconds: number | null): { readonly ms: number; readonly seconds: number } | null {
    if (seconds === null || !Number.isFinite(seconds) || seconds < 0) { this.finishAt = Number.NaN; this.shownSeconds = 0; return null; }
    const target = now + seconds * 1000;
    if (!Number.isFinite(this.finishAt)) this.finishAt = target;
    else this.finishAt += (target - this.finishAt) * (1 - Math.exp(-Math.max(0, now - this.at) / (FOLLOW_SECONDS * 1000)));
    this.at = now;
    const ms = Math.max(0, this.finishAt - now), exact = ms / 1000;
    let whole = Math.max(1, Math.round(exact));
    if (this.shownSeconds > 0 && whole > this.shownSeconds && exact < this.shownSeconds + RISE_SECONDS) whole = this.shownSeconds;
    this.shownSeconds = whole;
    return { ms: Math.round(ms), seconds: whole };
  }
}

/** "about 8 s", "about 1 min 5 s": the card's figure. */
export function timeLeftText(seconds: number): string {
  const whole = Math.max(1, Math.round(seconds));
  return whole < 60 ? engineString('s_loading_left_seconds', [whole]) : engineString('s_loading_left_minutes', [Math.floor(whole / 60), whole % 60]);
}
