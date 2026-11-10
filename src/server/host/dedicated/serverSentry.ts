// SENTRY-TRIAGE S8 (J238): the server's errors also go to Sentry's `wildshard-server` project. Error-only: no tracing, no
// breadcrumbs, no request data and no global handlers, since main.ts owns `uncaughtException`, and a listener here would
// change how the process ends. `capture` only queues; the send is a fetch with its own timeout, and one that fails is
// dropped. Nothing waits on Sentry except an ending process, which waits up to `FLUSH_MS` in `flush`.
// `@sentry/core` rather than `@sentry/node`: the same client the Node SDK wraps, without its instrumentation and build plugins.
import { createStackParser, createTransport, linkedErrorsIntegration, Scope as SentryScope, type BaseTransportOptions, type ErrorEvent,
  type Transport, type TransportMakeRequestResponse, type TransportRequest } from '@sentry/core';
import { nodeStackLineParser, ServerRuntimeClient } from '@sentry/core/server';
import { Scope } from '@wildshard/engine/app/scope';

/** One send's wait. */
const SEND_MS = 3000;
/** The longest an ending process waits for queued sends. */
export const FLUSH_MS = 3000;
/** Sentry keeps a dist of at most 64 characters (as the client's `browserErrorDist`). */
const MAX_DIST = 64;

export interface ServerSentryOptions {
  /** `SENTRY_DSN` from the channel's env file. Unset or blank, nothing is sent. */
  readonly dsn: string | undefined;
  /** package.json's version, baked in by scripts/build-server.mjs; unset outside a built bundle. */
  readonly version: string | undefined;
  readonly build: string;
  /** The release file's channel: `staging` or `production`. */
  readonly channel: string;
  /** For tests: the transport's fetch. */
  readonly fetch?: typeof fetch;
}

export interface ServerSentry {
  /** Queue one error. Never throws and never waits. */
  readonly capture: (error: unknown, tags: Readonly<Record<string, string | boolean>>) => void;
  /** Every queued send has landed or failed, or `FLUSH_MS` passed. */
  readonly flush: () => Promise<void>;
}

/** The client's release name (S5), so one engine version is one Sentry release across `wildshard-game` and `wildshard-server`. */
export function serverSentryRelease(version: string | undefined): string | undefined {
  return version === undefined || version === '' ? undefined : `wildshard@${version}`;
}

/** The server's events carry no request, user, host or extras (a thrown plain object lands in `extra`): only the error,
 *  the release and the tags given. */
export function scrubServerEvent(event: ErrorEvent): ErrorEvent {
  const { request: _request, user: _user, server_name: _host, breadcrumbs: _breadcrumbs, extra: _extra, ...rest } = event;
  return rest;
}

/** A capture waiting for its turn; more than this and the newest are dropped. */
const MAX_QUEUED = 32;
/** `promise`, or nothing after `ms`: an ending process never waits longer. */
async function within(scope: Scope, promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<Scope['timeout']> | undefined;
  await Promise.race([promise.catch(() => undefined), new Promise<void>(resolve => { timer = scope.timeout(ms, resolve); })]);
  scope.cancelTimer(timer);
}

function fetchTransport(send: typeof fetch): (options: BaseTransportOptions) => Transport {
  return options => createTransport(options, async (request: TransportRequest): Promise<TransportMakeRequestResponse> => {
    const response = await send(options.url, { method: 'POST', body: request.body as BodyInit, signal: AbortSignal.timeout(SEND_MS) });
    return { statusCode: response.status, headers: { 'x-sentry-rate-limits': response.headers.get('x-sentry-rate-limits'), 'retry-after': response.headers.get('retry-after') } };
  });
}

/** The server's Sentry, or undefined when the channel has no DSN. */
export function serverSentry(options: ServerSentryOptions): ServerSentry | undefined {
  const dsn = options.dsn?.trim();
  if (dsn === undefined || dsn === '') return undefined;
  const release = serverSentryRelease(options.version);
  const client = new ServerRuntimeClient({
    dsn, environment: options.channel, ...(release === undefined ? {} : { release }),
    ...(options.build !== '' && options.build.length <= MAX_DIST ? { dist: options.build } : {}),
    platform: 'node', runtime: { name: 'node', version: process.version },
    integrations: [linkedErrorsIntegration()], stackParser: createStackParser(nodeStackLineParser()),
    transport: fetchTransport(options.fetch ?? fetch), traceLifecycle: 'static',
    sendClientReports: false, sendDefaultPii: false, maxBreadcrumbs: 0,
    beforeSend: event => scrubServerEvent(event),
  });
  client.init();
  // The SDK builds the event and starts its send synchronously, so a capture only queues and the SDK runs on a later turn.
  const queued = new Set<Promise<void>>(), scope = new Scope('dedicated.sentry');
  return {
    capture: (error, tags) => {
      if (queued.size >= MAX_QUEUED) return;
      const turn = new Promise<void>(resolve => { scope.timeout(0, () => {
        try {
          const event = new SentryScope();
          event.setTags({ ...tags, build: options.build });
          client.captureException(error, { originalException: error }, event);
        } catch { /* A report never takes the server down. */ }
        queued.delete(turn); resolve();
      }); });
      queued.add(turn);
    },
    flush: () => within(scope, (async (): Promise<void> => { await Promise.all(queued); await client.flush(FLUSH_MS); })(), FLUSH_MS),
  };
}

/** What `main.mjs --sentry-test` needs: the env the unit gives the server, and the bundle's own build and version. */
export interface SentryTestOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly build: string;
  readonly version: string | undefined;
  readonly log: (line: Record<string, unknown>) => void;
  readonly fetch?: typeof fetch;
}

/**
 * S8's check: one deliberate event from this bundle, with this channel's DSN, then the exit code. Staging only: a
 * production server never sends a test event. 0 when Sentry took it.
 */
export async function sendSentryTest(options: SentryTestOptions): Promise<number> {
  const channel = options.env['RELEASE_CHANNEL'];
  if (channel !== 'staging') { options.log({ at: 'sentry.test.refused', channel: channel ?? null, reason: 'staging only' }); return 2; }
  const statuses: number[] = [], send = options.fetch ?? fetch;
  const sentry = serverSentry({ dsn: options.env['SENTRY_DSN'], version: options.version, build: options.build, channel,
    fetch: async (input, init) => { const response = await send(input, init); statuses.push(response.status); return response; } });
  if (sentry === undefined) { options.log({ at: 'sentry.test.refused', channel, reason: 'no SENTRY_DSN' }); return 1; }
  sentry.capture(new Error('SENTRY-TRIAGE S8: deliberate test event from a staging server'), { system: 'sentry-test', fatal: false });
  await sentry.flush();
  const ok = statuses.length > 0 && statuses.every(status => status >= 200 && status < 300);
  options.log({ at: ok ? 'sentry.test.sent' : 'sentry.test.failed', channel, release: serverSentryRelease(options.version) ?? null, statuses });
  return ok ? 0 : 1;
}
