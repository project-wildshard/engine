import type { HitHistory } from '../net/hitHistory';

const books = new WeakMap<object, HitHistory>();
/** Publish a host's hit history (P1-E5.3-G1). Only a room keeps one, so a page or a tape reads every body where it stands. */
export function publishHitHistory(host: object, history: HitHistory): void { books.set(host, history); }
/** The host's hit history. This half stays out of `net/`, which the shipped client does not reach: its seats ask here too. */
export function hitHistoryOf(host: object): HitHistory | undefined { return books.get(host); }
