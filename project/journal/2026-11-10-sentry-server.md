# Sentry for the dedicated server (SENTRY-TRIAGE S8)

Jake approved three Sentry projects (meta J238): the client, the
api-server and the MMO backend. This is the MMO backend's half.

- `serverSentry.ts`: `@sentry/core`'s `ServerRuntimeClient` with a fetch
  transport, not `@sentry/node`. The Node SDK 11 pulls build plugins,
  babel and oxc into the lockfile and patches http; we want none of it.
  `@sentry/core` was already in the lockfile through `@sentry/browser`.
- Error-only, no global handlers: main.ts owns `uncaughtException`, and
  a Sentry `unhandledRejection` listener would stop Node turning a stray
  rejection into a crash. `ServerReports.error` feeds it, so a worker
  crash and an uncaught throw both reach Sentry, and `settled()` waits
  for the flush before the process exits.
- Release `wildshard@<version>` like the client (S5), so one engine
  version is one Sentry release across both projects. `build-server.mjs`
  bakes the version in as `__ENGINE_VERSION__`. dist is the build id,
  environment the release channel.
- The DSN comes from `SENTRY_DSN` in `/etc/wildshard/<channel>.env`. Blank
  sends nothing, so local rigs and tests never report.
- `main.mjs --sentry-test` sends one deliberate event and refuses every
  channel but staging: the proof runs against the installed bundle.
- J206 Codex review: two MUST-FIXes, both fixed. A capture now only
  queues (the SDK runs in `setImmediate`, at most 32 waiting), and the
  scrub drops `extra`, where a thrown plain object kept its fields. The
  SHOULD (one outer deadline on flush) is in too.
- Timings for `test/dedicated-sentry.test.ts` recorded with `push-preflight.mjs timings` (about 3.3 s; the hanging-Sentry case waits out FLUSH_MS on purpose).
