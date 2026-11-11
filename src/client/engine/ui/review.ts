import { app } from '../app/runtime';
import { uiScope } from './ownership';
import { saveStorage } from '../saves/slots';
import { apiUrl } from '../core/apiOrigin';
// src/client/engine/ui/review.ts — the review inbox's always-loaded half (project/archive/2026-09-22-feedback-inbox.md): the Settings REVIEW unlock, the
// Quick note switch, and sending a note (with an offline queue). The composer itself (quick bar, sheet, pen) is the lazy
// src/client/engine/ui/Feedback.ts; the server is api/inbox.ts; notes come down with `pnpm inbox:pull`.
//
//   await unlockReview(pw)   → 'ok' | 'bad' | 'offline'    (POST { check: true }; a good password is remembered)
//   reviewUnlocked() / lockReview() / quickNote() / setQuickNote(on) / onReview(fn)   → Settings ▸ System ▸ Review and its Feedback row (SR13)
//   await sendNote({ note, category, context, screenshot })   → { id } | 'queued' | 'locked'
//   queuedCount() / flushQueue()   → a failed send waits in localStorage and retries on `online` and on the next send
//
// There is no query string: the feature ships to everyone and stays hidden until a reviewer types the password in Settings.
import { onOwnerDispose } from '../../../shared/engine/app/ownership';


const scope = uiScope('review', app.engineScope);

export type Category = 'bug' | 'art' | 'feel' | 'perf' | 'idea';
export const CATEGORIES: readonly Category[] = ['bug', 'art', 'feel', 'perf', 'idea'];
export type ContextValue = string | number | boolean | number[];
export interface NotePayload { note: string; category: Category; context: Record<string, ContextValue>; screenshot: string | null }
export interface StorageLike { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void }

const KEY = 'review';
const QUEUE_KEY = 'review.queue';
/** a queued note carries a ≤ 300 KB screenshot; localStorage holds ~5 MB, shared with the saves */
export const QUEUE_MAX = 6;
export const INBOX_URL: string = apiUrl('inbox');

interface ReviewState { password: string | null; quick: boolean }

const storage = (): StorageLike | null => saveStorage('global');

export function loadState(s: StorageLike | null = storage()): ReviewState {
  try {
    const raw = s?.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Record<string, unknown>>;
      return { password: typeof v['password'] === 'string' && v['password'] ? v['password'] : null, quick: v['quick'] !== false };
    }
  } catch { /* private mode / bad JSON: locked */ }
  return { password: null, quick: true };
}

function post(body: Record<string, unknown>): Promise<Response> {
  return fetch(INBOX_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

// ── the offline queue ──
export function readQueue(s: StorageLike | null = storage()): NotePayload[] {
  try {
    const raw = s?.getItem(QUEUE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as NotePayload[]) : [];
  } catch { return []; }
}
/** keeps the newest QUEUE_MAX; when storage is full the screenshots go first, the words stay */
export function writeQueue(q: readonly NotePayload[], s: StorageLike | null = storage()): void {
  const kept = q.slice(-QUEUE_MAX);
  try {
    if (kept.length === 0) s?.removeItem(QUEUE_KEY); else s?.setItem(QUEUE_KEY, JSON.stringify(kept));
  } catch {
    try { s?.setItem(QUEUE_KEY, JSON.stringify(kept.map((n) => ({ note: n.note, category: n.category, context: n.context, screenshot: null })))); } catch { /* storage off: the note is lost */ }
  }
}

/** 'sent' with the id, 'bad' = the password stopped working (locked again), 'retry' = offline / server trouble */
async function deliver(n: NotePayload, password: string): Promise<{ id: string } | 'bad' | 'retry'> {
  try {
    const res = await post({ password, ...n });
    if (res.status === 401) return 'bad';
    if (!res.ok) return 'retry';
    const body = (await res.json()) as { id?: unknown };
    return { id: typeof body.id === 'string' ? body.id : '' };
  } catch { return 'retry'; }
}

/**
 * One review desk over a storage: the unlock, the Quick note switch, the offline queue. The page has one (below); a test
 * builds its own to stand in for a fresh page, instead of reloading the module (E422).
 */
export class ReviewDesk {
  private readonly state: ReviewState;
  private readonly listeners = new Set<() => void>();
  private flushing = false;
  private readonly store: () => StorageLike | null;
  constructor(store: () => StorageLike | null = storage) { this.store = store; this.state = loadState(store()); }
  private save(): void {
    try { this.store()?.setItem(KEY, JSON.stringify(this.state)); } catch { /* not remembered this session */ }
    for (const fn of this.listeners) fn();
  }
  reviewUnlocked(): boolean { return this.state.password !== null; }
  quickNote(): boolean { return this.state.password !== null && this.state.quick; }
  setQuickNote(on: boolean): void { if (this.state.quick !== on) { this.state.quick = on; this.save(); } }
  lockReview(): void { this.state.password = null; this.save(); }
  /** fires on unlock / lock / the Quick note switch / the queue changing; returns an unsubscribe */
  onReview(fn: () => void): () => void { this.listeners.add(fn); const off = (): void => { this.listeners.delete(fn); }; onOwnerDispose(off); return off; }
  async unlockReview(password: string): Promise<'ok' | 'bad' | 'offline'> {
    const pw = password.trim();
    if (!pw) return 'bad';
    try {
      const res = await post({ password: pw, check: true });
      if (res.status === 401) return 'bad';
      if (!res.ok) return 'offline';
    } catch { return 'offline'; }
    this.state.password = pw;
    this.save();
    return 'ok';
  }
  queuedCount(): number { return readQueue(this.store()).length; }
  /** sends what is queued, oldest first; stops at the first failure. Returns how many went out. */
  async flushQueue(): Promise<number> {
    const pw = this.state.password;
    if (this.flushing || pw === null) return 0;
    this.flushing = true;
    let sent = 0;
    try {
      for (let q = readQueue(this.store()); q.length > 0; q = readQueue(this.store())) {
        const [head] = q;
        if (!head) break;
        const r = await deliver(head, pw);
        if (r === 'retry') break;
        if (r === 'bad') { this.lockReview(); break; }
        writeQueue(q.slice(1), this.store());
        sent++;
      }
    } finally { this.flushing = false; }
    if (sent > 0) for (const fn of this.listeners) fn();
    return sent;
  }
  async sendNote(n: NotePayload): Promise<{ id: string } | 'queued' | 'locked'> {
    const pw = this.state.password;
    if (pw === null) return 'locked';
    void this.flushQueue();
    const r = await deliver(n, pw);
    if (r === 'bad') { this.lockReview(); return 'locked'; }
    if (r === 'retry') { writeQueue([...readQueue(this.store()), n], this.store()); for (const fn of this.listeners) fn(); return 'queued'; }
    return r;
  }
}

/** the page's review desk */
const page = new ReviewDesk();
export function reviewUnlocked(): boolean { return page.reviewUnlocked(); }
export function quickNote(): boolean { return page.quickNote(); }
export function setQuickNote(on: boolean): void { page.setQuickNote(on); }
export function lockReview(): void { page.lockReview(); }
/** fires on unlock / lock / the Quick note switch / the queue changing; returns an unsubscribe */
export function onReview(fn: () => void): () => void { return page.onReview(fn); }
export function unlockReview(password: string): Promise<'ok' | 'bad' | 'offline'> { return page.unlockReview(password); }
export function queuedCount(): number { return page.queuedCount(); }
/** sends what is queued, oldest first; stops at the first failure. Returns how many went out. */
export function flushQueue(): Promise<number> { return page.flushQueue(); }
export function sendNote(n: NotePayload): Promise<{ id: string } | 'queued' | 'locked'> { return page.sendNote(n); }

if (typeof window !== 'undefined') scope.listen(window, 'online', () => { void flushQueue(); });
