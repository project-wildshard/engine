# Boot timing

LS1 installs one bounded plain object, `window.__bootTiming`, in the first
HTML script. `bootTiming()` from `@wildshard/engine/boot/timing` returns
that same object. Loading adopts it without replacing its history. A card
or Copy diagnostics can call `read()` and serialize the returned object;
functions naturally disappear from JSON. Nothing is uploaded or persisted
by the collector. Existing title-arrival intent carries only the previous
page's input and navigation origin stamps.
The inline clock lends its already parsed arrival to the collector,
avoiding another synchronous storage read. Input handler entry is the
capture listener's entry, distinct from the later navigation decision.

`entries` holds build, attempt, realm, operation, page-axis start/end,
result and detail. `active` is refreshed by `read()` with current ages.
`navigation`, `resources`, `realms`, `handoff`, `paints`, `lifecycle`,
`largestGap`, `serviceWorker` and `overflow` retain the other observations.
The build is adopted at entry; the document attempt is its time origin,
with the existing retry counter in `attemptCount`. Times are milliseconds.
Worker records retain their origin and use
`workerOrigin + workerStamp - pageOrigin`. Ping records retain all four
stamps; transit-and-queue is round trip minus worker handling, never an
inferred one-way delay.

The card may observe `counters` directly. `atomic:completed` counts actual
successful boundaries, `resource:completed` counts observed responses,
and each `download:<url>` counter counts actual decoded response chunks.
Worker counters have their realm prefix. `loaded` only increases;
`events` counts actual increments. `total: null` means no known fixed
denominator (also used after retries exceed the original body size).
These body bytes are not compressed wire bytes. A response may come from
HTTP, browser cache or the service worker; use the resource fields and SW
hit/miss records to describe its source, leaving unsupported fields
unknown. Never infer a percentage, cache source, parsing time or CPU time
from elapsed time. No existing estimated download figure is fed into the
collector.

`bootWork` observes synchronous work without creating a promise.
`bootTask` observes an existing async operation; `bootAwait` observes an
already scheduled literal import, preserving the build's import-bank
analysis. They retain failures and rethrow the original error. Server
world has separate imports, storage, physics, product reads, verification,
simulation/collision, restore, handshake and first-body boundaries.
Constructor-to-first-worker-message is explicitly a combined
fetch/evaluation/start/queue span. Helpers outside our source retain
parent-only observations and an unknown worker origin. Their span is
named `worker:constructor-to-first-message`; that first reply can include
the worker's first job and earns no code-ready completion credit.

Each list is bounded; overflow and unavailable APIs are explicit. The
100 ms scheduling probe only retains the largest observed gap. Loader
completion stops it, disconnects resource observation and retires worker
instrumentation. Open boundaries at that point become
`unresolved-at-loader-complete`, never successful steps. Failure keeps the
bounded object readable. Paint opportunities do not prove physical paint.
OS home-screen taps are unavailable to a page.

The manual milestone proof is outside hooks:

```sh
pnpm build:ring
scripts/browser-lane.sh node scripts/boot-timing-proof.mjs
scripts/browser-lane.sh node scripts/boot-timing-proof.mjs --delay=worker
```

It opens real iPhone portrait Chromium and WebKit boots, requires live
worker/world records, response byte chunks and retained early resources,
and refuses an unnamed interval over one second before the first game
step. Delay modes also include `js`, `styles`, `tables` and `server`.
`--handoff` navigates through the real title's Enter world control and checks
the old input stamps and both document origins before Loading adoption.
`--server-network` withholds only the optional page-held byte loan at the
test's transport boundary. The real worker then fetches its own book and
parts; the proof requires worker-realm streamed chunks and resources.
The server case injects a bounded async wait inside Sunscar's actual worker
world-boot boundary, separate from its code fetch and initial ping. Both
Ring 1 worlds can borrow their inputs without a server network read, so
delaying a nonexistent book request would prove nothing. `--sw=warm`
checks controlled cache records. `--delay=sw-open` and `--delay=sw-put`
serve an in-memory copy of the actual bundled service worker with a
1.25 s wait inserted inside that one measured cache boundary. Production
files stay untouched. The publication case removes only the build's
table/book entries between boots, retaining immutable content, to prove
the miss/publication path separately from a fully warm hit.
