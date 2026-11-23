/**
 * SENTRY-ZERO SZ2 (Jake, 2026-11-23: "turn off sending high volume warnings to sentry", "Everything in sentry MUST be a bug, and it
 * must be fixed and it must be low frequency"): which browser events may reach Sentry. Pure, so every rule is tested
 * (send-policy.test.ts); browserErrors.ts keeps the ledger in sessionStorage and applies it in the SDK's beforeSend, the one door
 * every report passes, a screen's outbox resend and the boot trace's delivery included.
 *
 * 2026-11-23's post-mortem: 81% of the month's 5,384 events were warnings and 78% came from agent sessions on staging, most of them
 * one warning screen (`map-tile-missing`) that S21's automation cap let through uncapped. So:
 *   - a warning or info event never sends: it joins the recent-warnings trail the next real event carries;
 *   - only `production` and `staging` send (and their `-automation` twins); preview and local never load the SDK;
 *   - an agent's session sends only on a 1% sample, decided once per tab session and tagged `agent`;
 *   - one event per fingerprint per tab session; later events carry how often each fingerprint repeated;
 *   - at most SESSION_EVENTS_MAX events a tab session, screens included.
 */

/** the most events one tab session sends, whatever they are */
export const SESSION_EVENTS_MAX = 10;
/** the share of agent sessions that send at all */
export const AGENT_SAMPLE_RATE = 0.01;
/** the Sentry environments that send; an automated page's `<environment>-automation` sends when its base does */
export const SENDING_ENVIRONMENTS: readonly string[] = ['production', 'staging'];
/** the most recent warnings a real event carries */
export const WARNING_TRAIL_MAX = 20;
/** the most fingerprints and event ids a ledger keeps, so it stays small in sessionStorage */
const FINGERPRINTS_MAX = 64;
const IDS_MAX = 32;

/** one tab session's sends */
export interface SessionLedger {
  /** this session's sample draw, for an agent session; unset until an agent page asks */
  agent?: boolean;
  /** events admitted */
  sent: number;
  /** the ids admitted, so an outbox resend of one is not a second event */
  ids: string[];
  /** times each fingerprint was offered (sent or not) */
  seen: Record<string, number>;
}
export function emptyLedger(): SessionLedger { return { sent: 0, ids: [], seen: {} }; }

/** A ledger read back from storage, or a fresh one when it is missing or malformed. */
export function parseLedger(raw: string | null): SessionLedger {
  if (raw === null) return emptyLedger();
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return emptyLedger();
    const { agent, sent, ids, seen } = value as Partial<Record<keyof SessionLedger, unknown>>;
    const counts = typeof seen === 'object' && seen !== null
      ? Object.fromEntries(Object.entries(seen).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : {};
    return { ...(typeof agent === 'boolean' ? { agent } : {}), sent: typeof sent === 'number' ? sent : 0,
      ids: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [], seen: counts };
  } catch { return emptyLedger(); }
}

/** Whether an environment sends: its base (without `-automation`) is production or staging. */
export function environmentSends(environment: string): boolean {
  return SENDING_ENVIRONMENTS.includes(environment.replace(/-automation$/u, ''));
}

/** An agent session's one draw: true for AGENT_SAMPLE_RATE of sessions, kept on the ledger so a reload draws nothing new. */
export function agentSampled(ledger: SessionLedger, random: () => number): boolean {
  ledger.agent ??= random() < AGENT_SAMPLE_RATE;
  return ledger.agent;
}

/**
 * One kind of event: the screen it opened, the system that threw and its message with every number and hash folded, so
 * "Read failed: /content/6d8e…/x.json" and the same read under another hash are one kind.
 */
export function eventFingerprint(parts: { readonly screen?: string | undefined; readonly system?: string | undefined; readonly message: string }): string {
  const message = parts.message.replaceAll(/[0-9a-f]{8,}/giu, '#').replaceAll(/\d+/gu, '#').slice(0, 160);
  return `${parts.screen ?? ''}|${parts.system ?? ''}|${message}`;
}

export type Admission =
  | { readonly send: true; readonly count: number; readonly repeats: Readonly<Record<string, number>> }
  | { readonly send: false; readonly reason: 'level' | 'duplicate' | 'cap' };

const QUIET_LEVELS = new Set(['warning', 'info', 'log', 'debug']);

/** The fingerprints this session offered more than once, and how often: the count a later event carries. */
function repeatsOf(ledger: SessionLedger): Record<string, number> {
  return Object.fromEntries(Object.entries(ledger.seen).filter(([, count]) => count > 1).slice(0, 10));
}

/**
 * Whether one event sends, updating the ledger. A resend of an admitted id always goes (it is the same event); a warning never
 * does; a fingerprint goes once a session; nothing goes past SESSION_EVENTS_MAX.
 */
export function admitEvent(ledger: SessionLedger, event: { readonly id: string; readonly level: string; readonly fingerprint: string }): Admission {
  if (event.id !== '' && ledger.ids.includes(event.id)) return { send: true, count: ledger.seen[event.fingerprint] ?? 1, repeats: repeatsOf(ledger) };
  if (QUIET_LEVELS.has(event.level)) return { send: false, reason: 'level' };
  const count = (ledger.seen[event.fingerprint] ?? 0) + 1;
  const keys = Object.keys(ledger.seen);
  if (count > 1 || keys.length < FINGERPRINTS_MAX) ledger.seen[event.fingerprint] = count;
  if (count > 1) return { send: false, reason: 'duplicate' };
  if (ledger.sent >= SESSION_EVENTS_MAX) return { send: false, reason: 'cap' };
  ledger.sent++;
  if (event.id !== '') ledger.ids = [...ledger.ids, event.id].slice(-IDS_MAX);
  return { send: true, count, repeats: repeatsOf(ledger) };
}
