# Developing engine

Living doc: commands, layout, code rules and git hooks. AGENTS.md links
here; what the repo does is `docs/prd.md`, how it is built `docs/design.md`.

## Commands

Run from the repo root.

- `pnpm install`: installs deps and points `core.hooksPath` at `.githooks/`,
  through `pnpm:devPreinstall`. Never use `prepare` here (`../repo-kit/docs/repo-kit.md`).
- `pnpm tools:install`: installs TypeScript7 and oxfmt from the committed
  `.bin-deps` lock into npr's shared cache, with `--frozen`. CI runs this
  after dependencies install. Typecheck/format commands use these pins;
  the optional TypeScript6 peer in node_modules is only a library.
- `pnpm check`: typecheck + lint + format:check + unit tests + the side rule + asks + page events. The pre-push hook runs it.
- `pnpm check:page-events`: every page `.on`, `ctx.on` and callback tap
  (`onKill`, `onWindup`, `onDamage`, `onSound`) has a row in
  `lint/page-events.json` naming a production producer and its proof flow
  (SPLIT-REPAIR SR12). A new listener, a producer that left, or a producer
  only tests reach is red: add or fix the row, never the gate.
- `pnpm test`: `node:test` on `src/**/*.test.ts`, run as .ts by Node's type stripping.
- `pnpm test` (it runs the `.githooks/` suite): the `.githooks/` suite (CI, and pre-commit when hooks change).
- `pnpm dev`: the game on http://127.0.0.1:4402 with its server as a local Node process
  (`src/scripts/dev.mjs`, MEMORY-STRUCTURE STR2/STR3, J414, J419): ring 1's pins, a
  devserver client build, and the dedicated server on loopback with saves on disk
  in PGlite under `tmp/dev-world/`. The page port stamps each document with the
  world, so no dev page starts the in-page server worker; only the deployed
  preview keeps it. A `src/server/` edit rebuilds the server and restarts the
  world (the page redials, about 2 s); a `src/client/` or `src/shared/` edit
  rebuilds the client and the page reopens on it. `--shard <slug>` (every pin),
  `--port`, `--saves memory`, `--dist <built folder>`, `--no-watch`. Delete
  `tmp/dev-world/` with dev stopped for a fresh world.
- `pnpm build`: builds the web app into `src/dist/web`.
- `pnpm test:e2e`: the `engine serve` status page, then the Template 2
  smoke (TEMPLATE-E2E, J233): the real title, a walk, the door, the
  guardian's quest and a reload, on one headless page. Template 2 comes
  from `@wildshard/format` (`pins.ts install --from-format`, beside the
  other pins), the client from a warm watcher (`scripts/e2e-watcher.mjs`,
  one per worktree under a build lease; `node scripts/e2e-client.mjs
  stop` frees it, and it idles out after 10 min). A one-line client edit
  is ready again in about 12 s. Each run's split is in
  `tmp/e2e/receipt.json`. `bash scripts/e2e-offline.sh` runs it with outbound
  networking denied by macOS.
- `pnpm fix` / `pnpm format`: the hooks only check; these fix.
- `node src/cli/main.ts --help`: the CLI without installing it. `serve [--port n]` starts the server (default 4402).
  The npm bin is `src/cli/engine.mjs`: it loads the format hook so `main.ts` runs from `node_modules`.
- `pnpm md:wrap`: rewraps Markdown prose to ~72 columns.
- `src/scripts/.kit/ask-new.sh "<Jake's words>"`: opens an ask (`docs/tasks/asks/README.md`).
- `src/scripts/browser-lane.sh node src/scripts/hud-worst.mjs --base=<url>`: the worst-case HUD, every
  element any shard shows on at once, screenshotted per browser, size and
  Developer mode, with the layout check (`--check`, `--menu`; A14). The
  URL is a `src/scripts/serve-build.sh` build.

## Progress epochs

`AppIdentity.saveEpoch` isolates a progress generation. `savePrefix` must be
a sibling of the previous prefix, and `serverSaveDatabase()` selects a
separate IndexedDB database. `previousSavePrefix` carries only settings,
graphics and device preferences on first boot; `identityPrefix` keeps the
device identity stable. Completion never reloads the page. Imports must
match the active epoch before any write or server stop. Keep the root
`save-epoch.json` equal to the application identity; the builder checks it
and publishes it in `version.json`. Snapshot format versions are separate.

Run the real storage boundary proof explicitly:
`src/scripts/browser-lane.sh node --test test/save-epoch-browser.proof.mjs`.

## Layout

The root stays thin: README.md and AGENTS.md (humans only), CLAUDE.md
(`@AGENTS.md`), package.json, pnpm-lock.yaml, .npmrc, .gitignore,
.editorconfig, `docs/`, `project/`, `src/` and the dot dirs. Scratch
goes in `tmp/<task>/` and is deleted when done.

- `src/cli/`: the CLI (`--version`, `--help`; commands arrive with the import).
- `src/test/helpers/`: shared test helpers; `git.ts` makes real git repos in temp dirs.
- `src/server/`: the Hono app (`GET /api/health`) and `serve.ts`.
- `src/shared/`: zod schemas used on both sides of the wire.
- `src/client/`: the Preact web app, with its own `tsconfig.json` (DOM lib).
- `src/tools/build-web.ts`: esbuild into `src/dist/web` (the kit status page; `--dev` watches and serves it).
- `src/e2e/`: Playwright: the status page, and `smoke/`, the Template 2 smoke.
- `src/cook/`: shardfile to runtime packs.
- `src/scripts/check-sides.mjs`: the side rule (`pnpm check:sides`).
- `src/scripts/.kit/`: repo tooling (asks, md-wrap, lint), plain JS (J329).
- `docs/`: living docs. `docs/plans/` is the queue, `docs/tasks/asks/`
  the receipts.
- `project/`: history. `journal/`, `origins/` (the meta-repo plans this
  repo came from), `archive/`.

## Code rules

- TypeScript only, imports with explicit `.ts`/`.tsx` extensions.
- Every function has an explicit return type. `.oxlintrc.kit.json` denies
  every category (D28); disable a rule only with a one-line reason beside it.
- Pin dependencies exactly (`.npmrc` has `save-exact=true`).
- Other Wildshard repos are git dependencies pinned by tag
  (`github:project-wildshard/<repo>#vX.Y.Z`). They are private, so CI reads
  them with the org GitHub App token.
- Tests use real things (git in temp dirs, real files and processes); never
  mock git. No LLM, `claude`, herdr or network in tests.

## Plan worktrees

A plan works in its own worktree (J240, meta DEV-SPEED DS12):

```sh
node src/scripts/.kit/worktree.mjs new <slug>   # .worktrees/<slug> on plan/<slug>, from origin/main
cd .worktrees/<slug>                   # commit here; then land:
WS_LANE_NAME=<lane> node src/scripts/.kit/land.mjs
```

`new` clones the canonical checkout's matching tracked files (APFS, no new
blocks), installs from pnpm's store offline, runs `pnpm pins` and records
its steps in `tmp/worktree-setup.json`. Every repo tool skips `.worktrees/`
(`src/scripts/.kit/worktree-ignore.mjs`, DS11).

## Git hooks

| Hook | Checks | Bypass |
| --- | --- | --- |
| commit-msg | Conventional Commits subject ≤ 50, body ≤ 72, one `Assisted-by: AGENT:MODEL` trailer, no AI `Co-Authored-By` | `SKIP_ATTRIB=1` (human-only commit) |
| pre-commit | `main` in the main checkout, `plan/<slug>` in `.worktrees/<slug>` (D27, J240), staged set echo, whitespace, 1 MB cap, credentials, sh / mjs syntax, new-plan Status line, journal (D25) | `ALLOW_BRANCH=1`, `ALLOW_BIG=1`, `ALLOW_SECRET=1`, `SKIP_JOURNAL=1` |
| pre-commit | Clean copy of the staged tree. Lint and format each have an 8 s budget. Typecheck has 45 s. | `SKIP_BUDGET=1` (time only), `SKIP_CHECK=1` |
| pre-push | outgoing commits: size, credentials, syntax; then `pnpm check` (a push that only deletes `plan/*` branches skips it) | `ALLOW_BIG=1`, `ALLOW_SECRET=1`, `SKIP_CHECK=1` |

Bypasses are for the case they name, never for a red gate: fix the code,
not the gate.

A pins install takes every zone's art from its shardfile and fetches
nothing from a shard repo (SF10): `test/pins/assets.json` and its fetcher
are gone, and `test/no-pinned-art.test.ts` keeps them gone. It writes
`out/<folder>` and nothing under `public/` (SF11): a page reads every zone
from the cook, and an install removes what an earlier one published. A
zoneless build refuses any file under `public/` or in `dist/` holding a
pinned blob's or mount's bytes (`src/scripts/pin-public-leaks.mjs`,
`test/pin-public-leaks.test.ts`). The app build
checks every declared baked texture mode before bundling and again in
final output, including the native image fallback. Native model-map source
keys are checked as well as the boot file lists; CPU model fallbacks must
survive final output pruning too.

## Exact item-model admission

The client model owner hashes only the supplied Uint8Array byte span,
including Node Buffer subclasses backed by a larger allocation. Shared
models stay live until their last Scope retires; late owners decode anew.
Run the native client-data proof explicitly, outside hooks:
`node --import ./src/scripts/bake-loader.mjs
--test test/ci/entry-model-values.proof.mjs` as one command. It uses the
renderer-capable author loader, not the simulation loader or a browser.
CI runs all three real geometry/lifetime/refusal/span cases with 9.5 s
timeout and complete-body elapsed limits. No production socket is used.

## Quest dialogue home lifetime

Run `node --import ./src/scripts/bake-loader.mjs --test test/ci/quest-home-lifetime.proof.mjs`.
CI runs these two cases explicitly; local hooks and Vitest discovery do
not add them. Happy DOM supplies the complete page environment; this is
not a renderer, road-travel or phone-layout claim.

The real grid cell event producer drives `RuntimePagePlugin` entry,
leave, neighboring-cell entry and retained-home return. A minimal authored
plugin opens a real dialogue through `QuestViews`; no retained hook is
activated directly. It proves closed DOM/input, cancellation of a due
real timer, no completion on leave, a fresh reading clock on return,
working new input/timers, retained authored state and final teardown.
The ordinary owner and quest placement refusals preserve the remaining
SDK lifetime laws. Each complete body has a 9.5-second elapsed assertion
and timeout. Scope and page cleanup always run; the proof opens no
browser, renderer, server or live socket.

## Hover movement contract

Run `node --import ./src/scripts/bake-loader.mjs --test test/ci/hover-boost.proof.mjs`.
Three CI-only cases stay outside hooks and Vitest inventory. They use the
real Player, actual pointer input, native Rapier and encoded client/server
commands. Fixed expected speeds come from displacement, not a tuning
getter. Developer-off retains the latch but refuses boost; the ordinary
server also refuses until its standalone capability is granted. Shared
policy coordinates are controlled inputs, not a grid crossing claim.
Every body, listener, page and global is retired; cases include cleanup in
both the 9.5-second timeout and elapsed assertion.

The existing nightly hover phase additionally reads the actual entered
player cap on the four padding heads, all Open Plots and Driftwood. Their
real admitted metadata must select 30/14 respectively, before the same
real-touch mount/unmount proof. Missing original contract heads refuse
before running. This adds no browser launch or gameplay phase; it does
not claim physical-phone qualification or a whole-nightly pass.

The manual `hover-contract.yml` qualification runs the original six heads
in both engines with at most two jobs at once. It reuses the entire cold
cook/boot/touch/draw/explorer path and validates each exact-SHA report
against committed pins. Only small JSON receipts are uploaded. This is a
partial SDK-row qualification; it cannot stand in for the full nightly.

## Native exchange edges

Install the two ordinary pinned products with
`node src/scripts/pins.ts install driftwood-isle pine-hollow`, then run
`node --import ./src/scripts/sim-node-loader.mjs --test test/ci/net-exchange.proof.mjs`.
CI runs both cases explicitly, outside hooks and Vitest discovery. Each
9.5-second timeout and elapsed assertion includes native product loading,
real physics, network input and cleanup.

Driftwood earns its coins through actual combat, refuses a card at one
coin short, and observes the already-paid purse in the real ownership
callback. Pine earns its hide by killing and harvesting a boar, takes two
placed resin pickups, refuses incomplete payment and keeps another
player from spending that stock. The authoritative rows reach actual
NetClients. Player placement isolates the transaction laws; it is not a
walked-journey proof. The real server stores acknowledge an in-process
forwarder, so this makes no database durability claim. No live server,
browser, forced health or synthetic reward is used.

## Native loadout contracts

After the same two pinned products are installed, run
`node --import ./src/scripts/sim-node-loader.mjs --test test/ci/native-loadout.proof.mjs`.
CI runs these three cases explicitly; hooks and Vitest do not discover
them. Each 9.5-second bound includes loading, physics and cleanup.

Actual Pine pickup, clock, shot, reload and reward inputs earn the rifle
and King-gated bow. Normal health, death and boss checkpoints remain
active. Controlled grounded firing positions isolate equipment laws;
this is not a walked boss encounter or a database durability proof.
The resulting live ownership book also drives 1,200 public author-API
frames: an independent clock oracle checks explicit pick priority,
ownership, swaps, live locks, reused publication sets and phase order.
Aim fallback, clamp and sentinel are author-port contracts; NaN cannot
cross the wire. Pending swaps round-trip through the real save adapter,
and invalid continuations leave state intact. Both stock kits retain
their authored slot/clock policies and strict preflight refusals. The
SDK predecessor remains until its owner approves retirement. A third
actual-room case refuses both unearned slots and proves that an explicit
choice wins when the same command also collects the rifle.

## Keyed sky clock contracts

After the ordinary Pine product install, run
`node --import ./src/scripts/sim-node-loader.mjs --test test/ci/keyed-sky-clock.proof.mjs`.
Three explicit CI-only cases retain independent authored sky/weather
numbers, the actual pinned day checkpoint suffix and strict data
admission. Each timeout and complete-body elapsed guard stays 9.5 s.
Clock output, preset independence and pause/resume are checked too.
These are numerical contracts, with no rendered-pixel claim or change.
The SDK owns installed packing, gzip and original worker bits; the old
waiting file is retained until its owner reviews the complete mapping.

## Interaction placement owner contracts

After the two ordinary Driftwood and Pine pin installs, run
`node --import ./src/scripts/sim-node-loader.mjs --test test/ci/interaction-placement.proof.mjs`.
Three explicit CI-only cases borrow actual quest progress, native floor
queries and public model/frame ports. A real, in-reach NetRoom greeting
unlocks both the authored lever condition and stock chest; out-of-reach
input stays refused. No flag is assigned by the test. Actual colliders
move from top 24 to 23 across the strict 20-metre reach, with live floor,
height, model anchor and explicit override precedence checks. Model
records are a caller port, not a rendered geometry claim. Both actual
pinned tables retain their original quest conditions and order.
Each complete case keeps 9.5 s including native cleanup; no live server,
walked journey or database durability is claimed. The SDK owns the
installed binding/reader counterpart. The original duplicate stays.

## Weather continuation owner contracts

After the ordinary Pine and Nalati pin installs, run
`node --import ./src/scripts/sim-node-loader.mjs --test test/ci/weather-legacy.proof.mjs test/ci/weather-continuation.proof.mjs`.
Explicit CI-only cases map all seven original waiting-file laws. The
legacy file runs in its own native-math process: old v1 saves and exact
recorded tails remain unchanged (the 19,200-output port oracle left with
ZONE-SNAPSHOTS ZS10).
The separate portable native realm accepts the same saves, repeats its
complete future wind/phase continuation and preserves atomic refusal
and publication identity. Its intentional existing portable-sine rounding
is not silently substituted into the historical oracle.

Nalati uses its actual pinned weather bundle and admitted raw return
module on a real renderer-free Rapier host. Public storm controls retain
the naturally seeded bolt schedule; no private register is assigned.
The original candidate-point data port proves high-point selection and
the 1.2-second warning, not a rendered forest. Cadence, shelter and opaque
restore preserve public outputs. The page case borrows only the public
system registrar and asserts a paused owner never advances. Every case
keeps 9.5 s including cleanup; none runs in hooks or Vitest. No runtime,
product, old test, pin, live service or image changes.

## Runtime render preparation contracts

Run `node --import ./src/scripts/bake-loader.mjs --test test/ci/runtime-render-preparation.proof.mjs`.
Six explicit CI-only cases enter a valid data product through the actual
RuntimePageSession, plan admission and strings.register feature. The
public product reader and render promise are borrowed loader boundaries;
prepare is never replaced. Actual installed text stays unpublished until
entry. Private construction overlaps rendering; ordinary entry waits.
World-read refusal, render refusal, cancellation and plan admission
refusal keep settlement and construction restoration behind the started
render promise, retaining the original error. Cancellation immediately
retires the preparation child; its resident render owner stays live
until that promise drains. The old external-module control becomes today's
actual data-plan admission, which no longer imports external runtimes.
These are non-rendering scheduling/lifetime contracts on a real App and
scope, with no GL, pixel or shipped-scene claim. Each complete case keeps
9.5 s including scope cleanup; none runs in hooks or Vitest. Old tests,
runtime, pins and generated tables remain untouched.

## Climate wire owner contracts

After ordinary Pine/Nalati pin installs, run
`node --import ./src/scripts/bake-loader.mjs --test test/ci/net-climate.proof.mjs`.
Eight explicit CI-only cases map all nine original groups. Actual local
Rapier hosts, NetRooms, NetClients and lossless loopback packets carry
day/weather acts and authoritative rows. The sky is a real shipped
WeatherContinuation; a public forwarding adapter records its accepted
calls without replacing its behavior. Unknown names, paused clocks and
shared rooms cannot accept a lone setting. A weatherless room continues
normally. Declared data climate advances all 1,200 ticks and quantised
day/weather rows reach the real client.

WirePage queues preferences until real frames, retains mode on a real
room/client rebind and consumes a phase jump once. This is a connection
boundary, not a walked grid crossing. The page clock follows actual rows
and remains frozen while paused. No fabricated client.latest, stateField
spy, fake weather, live server, renderer or browser is involved. Each
complete case keeps 9.5 s including clients, rooms and host disposal;
none runs in hooks or Vitest, and no old SDK file or runtime changes.

## Independent quest seat contracts

Install the ordinary Driftwood and Pine pins, then run
`node --import ./src/scripts/sim-node-loader.mjs --test test/ci/quest-seats.proof.mjs`.
These three explicit CI cases stay outside hooks and Vitest discovery.
Each complete case, including native world load and cleanup, retains a
9.5-second timeout and elapsed guard.

Actual headless quest inputs seat a second player on both authored cables,
advance and release its real motor, and earn only its own finish flag.
Driftwood carries an actual serialized mid-ride world through native
restore and earns the finish again. Pine opens and closes only the bot
board and trader, and its empty purse refuses a purchase. Positions are
controlled at authored prompts; this is not a walked journey, a database
durability proof, or a live-server connection. No flag, ride state, reward
or controller implementation is forced. The original SDK file remains
until owner review approves retirement.

## Native item-frame continuation

Install the ordinary Driftwood and Pine pins, then run
`node --import ./src/scripts/sim-node-loader.mjs --test test/ci/native-item-frame.proof.mjs`.
Three explicit CI cases preserve every original item-frame assertion:
ordered released input loans and reused arrays, all three ranged legacy
continuations, contacts and RNG over 1,500 ticks, actual mid-stream native
restore, atomic invalid reserve refusal, and 420 swept-melee ticks with
synchronous reaction order and saved state. Each complete case has a
9.5-second timeout and elapsed guard, including load and cleanup. They
remain outside hooks and Vitest discovery.

The numerical combat fixture retains its original high-health target so
all clocks and shots remain observable. It is not an earned-ownership,
complete authored journey, live-server or phone-rendering proof. Frozen
legacy algorithms consume preserved profile data; current item rows and
policies are read independently from actual immutable pinned products.
No runtime, tuning, pin, reward or test deadline changes here.

## Declared input and cosmetic migration

Install the existing Pine and Nine pins, then run
`node --import ./src/scripts/bake-loader.mjs --test test/ci/declared-input.proof.mjs`.
Eight explicit CI-only cases preserve all nine inherited groups. Actual
input commands respect mode, item and flags, inherited keys, closed
visibility and scope retirement. Admission rejects executable getters
without running them. Real SaveStore and ForwardedStorage documents
survive cosmetic slot migration and a fresh store/locker reload, with
one migration write and no repeated write. An acknowledgement is local
transport evidence, not a browser disk-durability claim.

Actual pinned Pine and Nine declarations retain their scalar kind,
phone/desktop values, temporary trim and restored tier. The control
declaration is fictional author data. No runtime or shipped content is
changed; this is not a rendered input, physical key, live-server or
visible cosmetic proof. Every complete case, including cleanup, has a
9.5-second timeout and elapsed guard outside hooks and Vitest. The
inherited SDK file stays excluded and retained for its owner to retire.

## Local failure proxy

`node src/scripts/chaos-proxy.mjs --work=tmp/chaos-owned` opens only loopback
listeners: page 18791, world 18792 and optional TLS world 18793. Its default
upstreams are page 18798, world 18797 and signed release 18799. Supply both
`--tls-cert=<owned PEM>` and `--tls-key=<owned private PEM>` for TLS. Tests
may pass zero ports. No upstream URL may leave 127.0.0.1 or include a path,
credentials, query or fragment. The optional API upstream is explicit;
without it `/api/` returns unavailable rather than reaching a live API.

The single readiness JSON line names an exclusive 0600 token file beneath
the work directory. Read it in the Node driver, never in page JavaScript.
Authenticated GET/POST `/__chaos` use `Authorization: Bearer <token>`.
POST atomically replaces `{scenario, rules}`; an empty array heals. GET
reports actual route matches, forwarded/dropped traffic and connections.
The control route has no permissive CORS. Invalid controls leave the
previous rules intact. No UI state or scenario mapping lives in the proxy.

Faults cover HTTP latency, status/Retry-After, stall, reset, bandwidth,
truncation and body replacement, and WebSocket refused upgrade, terminate,
half-open, coded close, seeded loss and delayed frames (plus bandwidth).
Socket direction is down by default, with explicit up/both. Seeded loss
can drop only binary prefix 1; reliable, ping/pong and voice prefix 8 are
preserved through the upstream. Native ws auto-pong observes only the
client-to-proxy hop. Rule activation applies to existing sockets too. Healing
releases delayed traffic; half-open drops are not replayed later.

Pack classification learns the real root book and declared manifest/member
URLs; unrelated assets are not guessed to be packs. Truncation leaves JSON
metadata intact and damages only a declared binary member, with an honest
short Content-Length and no-store response. The unchanged client must
still reject bad length/hash bytes. Doctor entry modules are learned from
the actual doctor document. The direct server release bypasses faults.

Control bodies are bounded at 128 KiB/32 rules, metadata at 2 MiB, pending
socket payload at 8 MiB/1024 messages and event samples at 256 entries.
Backpressure pauses both native sources and healing reevaluates both.
Shutdown and parent EOF retire only owned listeners, sockets, timers and
the exclusively created token path.

Run `node --test src/scripts/chaos-proxy-proof.mjs` explicitly. It uses the real
CLI, HTTP/WebSocket/TLS upstreams and native byte/close observations. All
13 faults, seeded controls, token/config/bind refusal, healing and parent
EOF run under ten seconds. This manual/Ring 2 proof never enters pre-push;
it does not qualify a game failure screen or replace FM3's browser census.

## Native compressed road surfaces

The phone grid uses native ASTC 6x6 sRGB asphalt and junction maps only
when the device probe sampled that exact format correctly at every mip.
`nativeCompressedFormatSupported(format)` in engine `core/ktx2` is the
public capability query; unknown formats or an incomplete probe return
false. Desktop, unsupported GPUs and failed reads retain the original
procedural painters. The composer keeps its signed-alpha colour marker.

The two maps are admitted before loading, uploaded before publication,
and shared by both road halves. One parent claim owns the pair until
retirement. Partial failures publish neither map and release their claim.

Reproduce the assets through the browser lane, with owned scratch:

```
src/scripts/browser-lane.sh node src/scripts/bake-road-surfaces.mjs \
  --scratch=tmp/<lane>/road-bake --out=public/assets/grid-road
```

The manifest binds both source files and every asset hash. Run
`test/road-surface-assets.test.ts` and the grid's
`road-compressed-surfaces.test.ts`; memory and all-six Chromium/WebKit
goldens are required before landing a changed format.


## Worker engine determinism (Ring 2 report)

Run `WILDSHARD_RING=1 node --import
./src/scripts/sim-node-loader.mjs src/scripts/determinism/report.ts` as one command.
It reads ordinary installed pins (three products and five server slices),
serves their exact admitted server bytes, and compares a real 48-tick walk
in Node and a dedicated WebKit worker. Each tick compares the full public
serialized save without rounding. A reversed-input control must fail the
same comparator. This opens no renderer and runs no cook.

The report remains outside hooks and push suites: compiling the worker,
starting a second engine and admitting all eight real worlds exceed ten
seconds. `engine-boundaries` runs it as an independent report-only job and
retains `tmp/worker-determinism/report.json`, including source/dirty state,
input identities, per-tick hashes and the divergent-tape witness.
`--engine=chromium` is a development control, never a JavaScriptCore proof.
Browser launch or worker failure is a refusal; it does not fall back.
Every browser, worker, server and generated bundle is closed or removed.

The comparison uses the full-check admission branch on both sides, whole
solids and a pageless fresh world. It covers neither near-solid streaming
nor progress seeded from a prior page. TC33 needs the hosted artifact to
say WebKit, completeRing/ok true, dirty false, eight products and a real
browser version/user agent; the Chromium control cannot close it.

## Earned declared journeys (TC7)

Run `node src/scripts/pins.ts install template`, then
`node --import ./src/scripts/sim-node-loader.mjs
--test test/ci/declared-journeys.proof.mjs` as one command.
CI invokes it explicitly; hooks and Vitest discovery do not add it.
The pinned Template walks the hut door, kills the blob and earns its quest.
The frozen format hall rejects remote USE, physically blocks its shut
door, opens to nearby USE, earns its quest and takes guardian damage.
Both fresh restores repeat a real suffix with the same full simulation snapshot, persisted player documents
and completed-tick effects. Real ledger filings grant five coins and one
quest receipt; replaying the actual fact after restore grants nothing.
Each complete case has a 9.5-second timeout and elapsed assertion. The
whole two-case process measured about one second locally. Every world
retires and removes its temporary player document; no socket, browser
or cook runs.
The hall's combat witness is guardian contact damage; it has no weapon.
The restored suffix is 60 idle ticks after earning, not re-earning from
an earlier checkpoint. Coin-effect replay deduplication belongs to the
room LedgerBook/bootId path and is outside these fact-receipt assertions.
Dunes' complete story and the per-slice host-wake bar remain separate.

### API validator identity (TC39 / AP-16)

`node src/scripts/api-health.ts` reads the exact resolved shard-format package
from `pnpm-lock.yaml` and compares it with `/api/health` on the deployed
API. The manifest's caret lower bound and the shard schema version are
different identities. A missing, malformed or unreachable health response
fails the observation; a mismatch names both package versions. One
three-second deadline covers the HTTP headers and JSON body.

The report-only Ring 2 `api-health` job records two independent results:
`proof.xml` qualifies the reader's test week; `report.json` observes the
deployment. `api_health_only=true` dispatches only this job, requires no
package install, and cannot qualify a nightly or become its baseline.
Artifacts last fourteen days. A green job alone proves neither result.

Run the real HTTP integration proof explicitly after a frozen install:

```sh
TC39_INSTALLED_FORMAT=1 node --test --test-timeout=10000 src/scripts/api-health.proof.ts
```

That environment flag requires the lock resolution to match the installed
package's name and version. The isolated nightly has no install, so this
one check skips there; all HTTP and diagnostic-selection cases still run.
The proof stays outside hook discovery and after CI wall accounting.
Admission needs its own actual green week and explicit review no earlier
than November 23, 2026. Skipped steps are not green observations.

The API deployment and normal reviewed pin alignment are tracked by meta
`test-coverage/MACBOOK-WAITS.md` MW12 and mini QA39. Until they ship, the
live report can correctly be red while the reader proof passes.

### Hosted outside bot (TC45 / XR-4)

Dispatch `outside-bot.yml` on the candidate branch for the public staging
path. It records independent fast proof XML and an actual live report;
inspect both, rather than the report-only job's colour. The driver checks
the signed staging release and builds the bot from its own engine commit,
so its wire bindings come from the signed release. The socket handshake
proves compatibility; the private room server build is not observed. The
report names signedReleaseBuild and the clean candidate source commit
separately. Only report.json with complete:true, exit:0 and left:true
counts; child output and workflow colour do not.

The one-bot command is:

```sh
node src/scripts/mmo-bots.mjs staging --outside-proof --bots 1 --seconds 60 --keep --work-dir tmp/tc45-outside/live
```

This mode refuses replicas, SSH, tailnet, extra clients and a signed
release naming anything except the public staging Tunnel socket. It
needs no private rooms health endpoint. It moves through ordinary input,
requires a settled owned hit plus lower creature health, drops its link,
resumes the same body and releases its seat. No production socket is
admitted. A failed/superseded live run cannot count as a complete proof.

Run the fast real-gateway observation explicitly:

```sh
node --import ./src/scripts/sim-node-loader.mjs --test --test-timeout=10000 test/outside-journey.proof.mjs
```

The four cases stay outside hooks. Earliest admission review is November
23, 2026 after their own actual green week; live receipts remain separate
from the source integration proof and retain fourteen days of artifacts.
