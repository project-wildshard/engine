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
- `pnpm test:hooks`: the `.githooks/` suite (CI, and pre-commit when hooks change).
- `pnpm dev`: esbuild watch + the server on http://127.0.0.1:4402.
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
- `pnpm lint:fix` / `pnpm format`: the hooks only check; these fix.
- `node src/cli/main.ts --help`: the CLI without installing it. `serve [--port n]` starts the server (default 4402).
- `pnpm md:wrap`: rewraps Markdown prose to ~72 columns.
- `src/scripts/ask-new.sh "<Jake's words>"`: opens an ask (`docs/tasks/asks/README.md`).
- `scripts/browser-lane.sh node scripts/hud-worst.mjs --base=<url>`: the worst-case HUD, every
  element any shard shows on at once, screenshotted per browser, size and
  Developer mode, with the layout check (`--check`, `--menu`; A14). The
  URL is a `scripts/serve-build.sh` build.

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
`scripts/browser-lane.sh node --test test/save-epoch-browser.proof.mjs`.

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
- `src/tools/build-web.ts`: esbuild into `src/dist/web` (`--dev` watches and serves).
- `src/e2e/`: Playwright: the status page, and `smoke/`, the Template 2 smoke.
- `src/cook/`: shardfile to runtime packs.
- `src/scripts/check-sides.mjs`: the side rule (`pnpm check:sides`).
- `src/scripts/`: repo tooling (asks, md-wrap), plain JS.
- `docs/`: living docs. `docs/plans/` is the queue, `docs/tasks/asks/`
  the receipts.
- `project/`: history. `journal/`, `origins/` (the meta-repo plans this
  repo came from), `archive/`.

## Code rules

- TypeScript only, imports with explicit `.ts`/`.tsx` extensions.
- Every function has an explicit return type. `src/.oxlintrc.json` denies
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
node scripts/worktree.mjs new <slug>   # .worktrees/<slug> on plan/<slug>, from origin/main
cd .worktrees/<slug>                   # commit here; then land:
WS_LANE_NAME=<lane> node scripts/land.mjs
```

`new` clones the canonical checkout's matching tracked files (APFS, no new
blocks), installs from pnpm's store offline, runs `pnpm pins` and records
its steps in `tmp/worktree-setup.json`. Every repo tool skips `.worktrees/`
(`scripts/worktree-ignore.mjs`, DS11).

## Git hooks

| Hook | Checks | Bypass |
| --- | --- | --- |
| commit-msg | Conventional Commits subject ≤ 50, body ≤ 72, one `Assisted-by: AGENT:MODEL` trailer, no AI `Co-Authored-By` | `SKIP_ATTRIB=1` (human-only commit) |
| pre-commit | `main` in the main checkout, `plan/<slug>` in `.worktrees/<slug>` (D27, J240), staged set echo, whitespace, 1 MB cap, credentials, sh / mjs syntax, new-plan Status line, journal (D25) | `ALLOW_BRANCH=1`, `ALLOW_BIG=1`, `ALLOW_SECRET=1`, `SKIP_JOURNAL=1` |
| pre-commit | lint + format:check on staged code, typecheck; 8 s budget | `SKIP_BUDGET=1` (time only), `SKIP_CHECK=1` |
| pre-push | outgoing commits: size, credentials, syntax; then `pnpm check` (a push that only deletes `plan/*` branches skips it) | `ALLOW_BIG=1`, `ALLOW_SECRET=1`, `SKIP_CHECK=1` |

Bypasses are for the case they name, never for a red gate: fix the code,
not the gate.

Frozen product image fallbacks may be listed in `test/pins/assets.json`.
Their small files live under `test/pins/assets/`, with immutable producer
Git provenance, SHA-256 and byte count. `pins.ts install` validates them
before publishing through its ordinary mount ledger. Remove an old
bridge pin when refreshing to a product that carries the same URL; a
different body is a hard publication collision, never an override. The
app build checks every declared baked texture mode before bundling and
again in final output, including the native image fallback.

Larger original model fallbacks use `remote: true` pins from an immutable
public producer commit (including the frozen singleplayer source). The
installer downloads them to the normal pins cache, bounds the stream to
the declared length, and verifies SHA-256 plus the source Git blob before
publication. No mutable branch, token or private checkout is needed.
Native model-map source keys are checked as well as the boot file lists;
CPU model fallbacks must survive final output pruning too.

## Exact item-model admission

The client model owner hashes only the supplied Uint8Array byte span,
including Node Buffer subclasses backed by a larger allocation. Shared
models stay live until their last Scope retires; late owners decode anew.
Run the native client-data proof explicitly, outside hooks:
`node --import ./scripts/bake-loader.mjs --experimental-transform-types
--test test/ci/entry-model-values.proof.mjs` as one command. It uses the
renderer-capable author loader, not the simulation loader or a browser.
CI runs all three real geometry/lifetime/refusal/span cases with 9.5 s
timeout and complete-body elapsed limits. No production socket is used.

## Quest dialogue home lifetime

Run `node --import ./scripts/bake-loader.mjs --experimental-transform-types --test test/ci/quest-home-lifetime.proof.mjs`.
CI runs these two cases explicitly; local hooks and Vitest discovery do
not add them. Happy DOM supplies the complete page environment; this is
not a renderer, road-travel or phone-layout claim.

The real grid cell event producer drives `HybridShardPlugin` entry,
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

Run `node --import ./scripts/bake-loader.mjs --experimental-transform-types --test test/ci/hover-boost.proof.mjs`.
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
`node scripts/pins.ts install driftwood-isle pine-hollow`, then run
`node --import ./scripts/sim-node-loader.mjs --experimental-transform-types --test test/ci/net-exchange.proof.mjs`.
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
`node --import ./scripts/sim-node-loader.mjs --experimental-transform-types --test test/ci/native-loadout.proof.mjs`.
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
`node --import ./scripts/sim-node-loader.mjs --experimental-transform-types --test test/ci/keyed-sky-clock.proof.mjs`.
Three explicit CI-only cases retain independent authored sky/weather
numbers, the actual pinned day checkpoint suffix and strict data
admission. Each timeout and complete-body elapsed guard stays 9.5 s.
Clock output, preset independence and pause/resume are checked too.
These are numerical contracts, with no rendered-pixel claim or change.
The SDK owns installed packing, gzip and original worker bits; the old
waiting file is retained until its owner reviews the complete mapping.

## Interaction placement owner contracts

After the two ordinary Driftwood and Pine pin installs, run
`node --import ./scripts/sim-node-loader.mjs --experimental-transform-types --test test/ci/interaction-placement.proof.mjs`.
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
`node --import ./scripts/sim-node-loader.mjs --experimental-transform-types --test test/ci/weather-legacy.proof.mjs test/ci/weather-continuation.proof.mjs`.
Explicit CI-only cases map all seven original waiting-file laws. The
legacy file runs in its own native-math process: all 19,200 historical
Pine outputs, old v1 saves and exact recorded tails remain unchanged.
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

## Hybrid render preparation contracts

Run `node --import ./scripts/bake-loader.mjs --experimental-transform-types --test test/ci/hybrid-render-preparation.proof.mjs`.
Six explicit CI-only cases enter a valid data product through the actual
HybridRuntimeSession, plan admission and strings.register feature. The
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
`node --import ./scripts/bake-loader.mjs --experimental-transform-types --test test/ci/net-climate.proof.mjs`.
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
`node --import ./scripts/sim-node-loader.mjs --experimental-transform-types --test test/ci/quest-seats.proof.mjs`.
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
`node --import ./scripts/sim-node-loader.mjs --experimental-transform-types --test test/ci/native-item-frame.proof.mjs`.
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
`node --import ./scripts/bake-loader.mjs --experimental-transform-types --test test/ci/declared-input.proof.mjs`.
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

`node scripts/chaos-proxy.mjs --work=tmp/chaos-owned` opens only loopback
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

Run `node --test scripts/chaos-proxy-proof.mjs` explicitly. It uses the real
CLI, HTTP/WebSocket/TLS upstreams and native byte/close observations. All
13 faults, seeded controls, token/config/bind refusal, healing and parent
EOF run under ten seconds. This manual/Ring 2 proof never enters pre-push;
it does not qualify a game failure screen or replace FM3's browser census.
