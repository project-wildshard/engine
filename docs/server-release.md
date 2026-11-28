# Dedicated server release CI

The `server-release` workflow implements E7.2c's producer half. It builds
the dedicated target, attaches its immutable archive to a GitHub Release,
then advances one signed channel object in `wildshard-packs`. It does not
contact the VPS. C21's running poller checks the archive and preloads packs
before the grace; C24 keeps the old bundle and its signed file on failure.

A main push qualifies for staging only when **both** `ci` and `ring-1`
have succeeded for that exact main SHA. Completion of either workflow
wakes the producer. A pending companion workflow leaves publication to
its completion event. PR and fork events cannot enter the signing job.
An unrelated or older completed build cannot displace a newer channel.

**Every channel signs packs-first (J234).** Jake, 2026-11-10: "staging
needs to be healthy. we can't show these half-assed, half-open,
half-closed failure states," and then: "We should make sure that
staging and prods have these checks, so we never switch a build whose
files aren't uploaded." The running server loads the named build's server book and parts
before its grace, and stays on its old build while they are missing. So a
staging file that names a build with no book strands the server, the page
and every doctor check behind it (serial 63 named `b721769` while its book
was 404 and the server sat on `a8144a5`). Before signing a staging or
production file, `publish.mjs` reads `assets/spawn/server-<build>.json` from the bucket and
heads every part the release's pinned shards and the grid name. If any is
missing the run reports `held`, with a notice, and the channel keeps naming
the last build whose packs are published. For a production tag, publish
the packs and then re-run that tag's server-release run.
`test/server-release-ci.test.ts` proves held and published on both
channels, and the forward-only alignment, against a real S3 boundary.

Before production signing, the exact candidate also boots every head the
production catalogue currently advertises and advances each room by 600
ticks. Any refused head or a catalogue change during the replay blocks
signing. The `production-play` workflow artifact records the verdict.

The order is: publish the build's server book and parts (the staging
page/pack publish), then sign the release file (this workflow), then the
server moves (its poller preloads, counts down 60 s and restarts), then
alias the staging page to the same build. If a step fails, the previous
signed file stays live and the server keeps serving it.

Release readers verify the signature over the full body, validate known
fields and accept additive fields (QA58). If a running older poller
rejects an additive field after preloading, verify the signed bundle
and confirm the room count is zero. Restart the affected room service
through the existing allowlist. Its startup pull verifies and activates
the bundle. Read the exact build and serial from health before aliasing.

**A placed cell is not a release (SA33).** A new slug the API places on
the grid (SA30) reaches a running `WORLD_CELLS=grid` server through a
second signed file, the placement file (`placementFile.ts`): `channel`,
`serial` and `cells` (`instance`, `slug`, `cell`), signed with the API's
own placement key, never the release key, which vouches for the bundle.
The server reads it at `PLACEMENT_URL` with `PLACEMENT_PUBLIC_KEY` (both or
neither) at boot and each minute, places each new cell on an empty spot,
preloads its pack from this build's book (a cell with none waits for the
next look) and opens it on a worker of its own: no grace, no restart, and
no other cell is touched. `/health` says `placements: <serial>`. With
roads on (`WORLD_CROSSING=worker`, SA34a) it opens instead on the worker of
the open cell nearest it, since a seat crosses only inside one worker, and
every worker's road is told: no void floor over its square, road-level
strips round the grown grid, and walls on the roads that can't hand a seat
in.

## Page release

From the MacBook's canonical engine checkout, the train command cuts the
newest exact green main, runs local QA, prepares the branch, waits for
release CI and runs staging go-live.

```bash
src/scripts/release.sh vX.Y.Z --notes <notes-file>
```

Use `--dry-run` to check the source and cadence before cutting.
`--on-demand` opens an early cut when the coordinator requests one.
Repeat `--require <sha>` to select a green main containing every commit
in a coordinated batch.
The train starts npm next as soon as candidate QA and the signed staging
alias agree. The live smoke and J451 continue during publication. It verifies
both immutable client archives and the public npm tarball. Delivery
evidence is under `tmp/release-train-vX.Y.Z`. The local rig keeps its QA
verdict in `tmp/qa-vX.Y.Z-<short-sha>` beside its short Unix socket path.

Run the same command to continue a partial delivery from the same lane
session. It reuses the published branch and any existing exact npm run.
It resumes a held J451 tour from the failed crossings. Tag, production
and npm latest use their normal release gates.

The channel pages ship with one committed script, in four phases, from
one clean release clone per channel at the exact SHA (never a worktree
with untracked pins, never the canonical checkout):

```
node src/scripts/page-release.mjs staging build,go-live --local-qa=<local-verdict> --qa-out=<evidence-dir>
node src/scripts/page-release.mjs production build|upload|check|go-live --qa=<verdict.json>
node src/scripts/page-release.mjs preview build,upload,check,go-live
```

No channel publishes a content set (fix preview PV17, then PV15): zones
come from the cook, page-release refuses `--content`, and the build joins
`dist-content/` back into the page (staging and production join engine
art only, refusing shard content). The old sets in wildshard-packs go
through `src/scripts/content-prune.mjs` (daily, `content-prune.yml`) once
no live page, retained build or cook index reads them.

A comma list runs the phases in order and stops at the first failure.
Every channel's page is a Cloudflare Worker (OFF-VERCEL OV6 preview,
OV7 staging, OV8 production), so `--host` has one value, `workers`, the
default. `preview.yml` runs preview hourly for the newest green main (OV6).
Preview is the solo game: its page carries no release file or world stamp.
The deployment signs `preview.json` in `wildshard-releases` after
upload. It verifies the build, epoch and serial before go-live and rejects a
socket or server bundle. The signer uses the same CAS and fix-forward
rules as staging. Its workflow needs `E7_RELEASE_SIGNING_KEY` and the
release bucket's scoped R2 keys. The page never reads this gate and
remains fully solo and offline-capable. Preview rollback to an older
commit is refused: publish a green descendant to fix forward.
`E7_RELEASE_PUBLIC_KEY`, when set, must equal the reviewed key pinned
in `page-release/flow.mjs`; it cannot replace the trust root.

Preview borrows staging's grid (SHARD-AUTHORING SA35): before the build,
`src/scripts/preview-grid.ts` reads staging's signed placement file (the one
the staging MMO reads at `PLACEMENT_URL`) under the placement key with
engine's `readPlacementFile`, adds its cells after the pinned 25 in
`tmp/preview-grid/catalogue.json`, and `page-release.mjs preview
--catalogue=<file>` bakes that. No file (404) is the pinned grid. Staging
unreadable keeps the live preview's grid and the run warns. A new
staging placement deploys preview even when no client input changed.

| Phase | Does | Never |
| --- | --- | --- |
| `build` | `pnpm build:game` with `WS_BUILD_ID=<sha>`, `WS_RELEASE=1`, `WS_CHANNEL=<channel>` (old builds carry from the channel's own domain, OFF-VERCEL OV3) and `WILDSHARD_RELEASE_URL=https://releases.wildshard.io/<channel>.json`, then the host's packaging. The build fails above 90,000 files or any file over 25 MiB (Workers static-asset limits; source maps not counted). Checks the output names this build, this channel's release file and key, and not the other channel's file. | uploads |
| `upload` | The server book and parts to the packs bucket, parts first and the book last, each read back through `packs.wildshard.io` with the channel page's `Origin` (CORS). Existing objects must have the same bytes. Each read adds a fresh query, because the CDN caches 404s. Then the page, unaliased. | moves the alias |
| `check` | The uploaded page's `version.json`, `index.html`, `sw.js` and `deploy-chunks.json` equal the local build; the packs answer with CORS; then waits (`--wait=<minutes>`, 45) until the signed release file names this build, epoch and channel socket and the channel's tailnet `/health` shows this build at that serial. | moves the alias |
| `go-live` | Re-reads the signed file and `/health` and refuses unless they still match, then moves the alias (last) and waits for the domain to serve the build. | runs without a fresh match |

Staging `check` and `go-live` also ready the signed cells added after
the built-in grid. `src/scripts/release-placed-ready.mjs staging` verifies
their exact-build public cook indices, or runs the normal CookWorker
with the existing `R2_ACCOUNT_ID`, `R2_BUCKET_PACKS` and
`R2_PACKS_ACCESS_KEY_ID` / `R2_PACKS_SECRET_ACCESS_KEY`. Credentials stay
in the parent; the restricted cook child receives none. A changed
placement snapshot refuses the phase so it can be retried. This checks
current placements before aliasing; later uploads still use the normal
upload/cook activation path.

Staging async uploads require the cook to use the same exact build.
Before `go-live` moves the page alias it runs
`node src/scripts/release-cook.mjs --staging --build=<sha>`. This verifies
the signed staging server tag and uses the root helper's normal cook
rebuild, health check and rollback. An older installed helper upgrades
only through the existing signed-source/harden guard. A failed move
refuses the alias. The later `release-cook.mjs vX.Y.Z` production step
also refuses to rewind a newer staging cook. When `src/scripts/vps` changed
since the box's last harden (wildshard-apply's stamp, else the cook's
previous build), either step then runs `wildshard-apply <tag> harden`
behind the same `--check` gate (FAST-RELEASE FR-A11); a refusal is a
`warn` line that names why, and the release goes on.


Each phase refuses until the one before it has run for the same SHA
(results in `<clone>/tmp/page-release/<channel>-<sha>.json`). Production
`check` and `go-live` also need the `v<version>` tag on origin at this
SHA and `staging.wildshard.io` already serving it; `go-live` needs
`--qa=<verdict.json>` from `staging go-live` for the exact build,
including the J476 zone-entry result on the staging origin.
After aliasing, the domain check waits for both `version.json` and the
HTML to name the new build and for the HTML to name its release URL.
The staging verdict replaced `--after-staging-proofs` (Doctor and the live
two-player proof), `verify-staging.sh`'s eight journeys and two zone
sweeps, and `--smoke`: about 42 minutes a release (J427). Go-live
refuses without a verdict, for another build, a local or partial leg,
a scenario that did not run, or a P0 or P1. `journey-proof.mjs
--prime <dir>` starts from saved profiles (`<dir>/chromium`,
`<dir>/webkit`), an old shell as a returning phone holds one, and
`--throttle 4` slows Chromium's CPU like a Low Power phone; primed runs
are reported but are not the gate's cold or warm. J205: the script opens no socket; production's own proof is
`e7-doctor-proof.mjs <origin> <sha> <key> --human-static`. After each
staging tag, beside GC17's crossing walk, `node src/scripts/net-lag-proof.mjs`
reads NET-LAG's "buttery" bar (B1 to B4) on staging, both engines and
layouts, every deck shard; it gates no release yet. The scratch
scripts' `/api/*` 401 checks are gone: the page's API is
`api.wildshard.io` (API-CLOUDFLARE AC11), not the page host.
If go-live fails after an `ALIAS MOVED` line, the alias did move; fix
forward (J179).

Production go-live reads the page against its content set twice (QA 11-25
row 131, after v0.1.92's 357 missing paths): just before the alias moves
(the local build) and after it (the live page). Every content path the
page, its boot tables, its spawn books and their lists name must be in
the set's `content.json` and answer 200 with play's CORS, and must hold
the bytes of the set staging QA played (the staging verdict's
`contentBase`; spawn books and lists are channel-bound and skipped).
A miss refuses; after the move the alias stays, so fix the set forward.
`ALLOW_CONTENT_GAPS=1` (J381) lets a fix-forward release through. By hand:
`node src/scripts/page-release/content-reach.mjs [--page=dist]
[--staging-base=<url>]` (J205: static reads, no join).

`--dry-run` prints every step with the token as `<token>`, reads the
live signed file and `/health`, and lists what would refuse today. It
builds, uploads and aliases nothing.

Release from `release/vX.Y.Z` (meta RELEASE-BRANCHES, J360/J362).
Start with local QA on the exact green main commit chosen for the cut.
The phone leg uses muted, headless WebKit at 402×874 and checks world
draw and touch-stick movement. Keep the full verdict with the release. From main, run
`../repo-kit/release.sh vX.Y.Z --prepare --from <source-sha> --notes <file>`.
The helper writes the version, changelog and stamps on the release branch.

Use a clean staging clone at the release head. Run `staging build`, then
`staging go-live --local-qa=<local-verdict> --qa-out=<evidence-dir>`.
Go-live arms the MMO observer before rooms move, uploads the page and
packs, and checks the exact signed rooms and Worker version. It runs
K1–K6, the zone-gate play leg, Doctor and a read-only WebKit phone load.
The smoke checks world draw and continues through Play anyway if shown.
If rooms request a reload, the MMO observer compiles the signed target
client and redials with the same identities. MS9 reports its continuity
result separately as a staging note. After the alias move
the command reruns live M3. The J476 smoke walks 16 seeded crossings
on phone-profile WebKit. Three sessions run 5, 5 and 6 crossings. Each
featured shard is entered twice through live shared gates. Every arrival
needs drawn play and working movement within 90 seconds. The staging
`verdict.json` keeps every failed pair and holds the release until all 16
have passed on the same build.
The local verdict must name the release commit's parent. Use the final
verdict as production's `--qa` input. For an already live release,
`--observer-proof=<file>` supplies its saved MS9 witness for verification.
Pass the held staging verdict (or its `zone-entry/zone-entry.json`) as
`--zone-entry-resume=<file>` to rerun only the failing crossings.

Release and QA runs use `tmp/$WS_LANE_NAME/<run>` and remove their work
on exit, including a held run. `--out` and `--qa-out` receive the verdicts
used by the next step. The deploy evidence also keeps `qualification.log`
and `live.log`. Go-live prints the last lines when a QA leg exits without a
verdict. The train keeps those proof and dispatch records in
`~/.cache/wildshard/plan-artifacts/release-qa/`. Each page build still
keeps its phase record for the following upload and alias commands.
`node src/scripts/.kit/worktree.mjs reap --dry-run` lists scratch idle for 24 hours
with no Git metadata or open files. Omit `--dry-run` to remove that scratch.

For a standalone smoke, run `src/scripts/browser-lane.sh node
src/scripts/zone-entry-tour.mjs --expected-build=<sha> --out=<dir>`.
Use `--seed <number>` to repeat a draw, `--retry-failed <verdict.json>`
to carry forward successful pairs, or `--full-route` for the original walk.
Print the train order with
`node src/scripts/staging-qa.mjs --train --dry-run --release vX.Y.Z`.

For a standalone live rerun after go-live:

```bash
WS_LANE_NAME=codex-ms BROWSER=none bash src/scripts/browser-lane.sh --max 18 \
  node src/scripts/staging-qa.mjs --release vX.Y.Z --build <exact-sha> --fix-owner <lane>
```

The staging deploy smoke checks entry to play, world draw, movement, the
load budget, error cards, deep links and a gate crossing. Vision reports
separately. On P0 or P1, keep the verdict and board, write the
`staging-qa HOLD` receipt, and add or update the STAGING-BUGBASH row
with the fix-forward lane. Hold promotion of that build. Engine, SDK and
format cuts continue. Any staging publish pause applies only to the
colliding revision, for at most 30 minutes (J505). The live page stays
in place (J426).

`release.sh vX.Y.Z
--finish` tags the exact green head; the tag signs production and
starts npm OIDC publishing. `--published` waits for npm's listing;
never rerun the publish job while npm processes it. Production build
and upload may run once the build is green. Run `production check`,
then `production go-live --qa=<the staging go-live verdict.json>`,
then the static Doctor with `--human-static` (J205).

Placed zones (the API's grid cells, which the release file does not
name) reach production only by a production flip. The release lane owns
that: after a production release, it dispatches
`gh workflow run production-placements.yml -f slugs=<a,b>` for each
placed zone staging has moved ahead (fix preview PV32). The job flips
each slug to the hash staging's signed placement file places, then fails
unless production's placement file matches.

The cook follows production: `node src/scripts/release-cook.mjs vX.Y.Z`
moves it through `wildshard-agent` and `wildshard-config cook` (J355).
Finish from primary main with `release.sh vX.Y.Z --merge-back`: merge
without fast-forward, retry against moving main, then remove the
published branch/tree. The next prepare requires this tag in main
history. The train cuts every four hours plus on demand (J391, FS28).

Pack writes use `wrangler r2 object put` with wrangler's login.
The page upload puts the build's road strips and grid-only book on
`cooked.wildshard.io` before publishing the legacy server book the signer
checks. The check phase verifies the cooked road bytes and channel CORS.
After `ROOMS_VERSIONED_COOK=1`, the room logs `road.pack` with
`source: "cooked"` when the road loads. The build ID in the book must
match the room's release. Both channels run `ROOMS_VERSIONED_COOK=1`
from v0.1.101 (production set 11-28 with `--production`). A release
whose signed file has a cook needs it: without it the room logs
`release.failed` "Missing server input shard.json" and keeps the old
build. A rollback to a release with no cook (v0.1.100 or older) sets it
to 0 first, or the room throws "A versioned room needs a signed cook
address".

The `server-release.yml` author-client job builds
`devserver-client.tar.gz` and `preparation-client.tar.gz` from the
release SHA and checks each archive's `version.json` before upload.
Check the preparation archive on the immutable release tag before
handing the build to a shard lane for `wildshard prepare`. If its build
fails, the author-client job reports the failure and still uploads a
valid devserver archive.

The host is `src/scripts/page-release/hosts/workers.mjs` (OFF-VERCEL OV4), the
Cloudflare host: three Workers from `pages/wrangler.jsonc` (production
is `--env ''`, then `--env staging` and `--env preview`). `package`
sends the source maps to Sentry, strips them from `dist/` and checks
the asset limits. `upload` is `wrangler versions upload --tag <sha>
--message v<version>`, a version only. The check reads `wrangler
versions view <id> --json` (its tag must be the build) and the SHA-256
of each document from the version's own preview URL. `go-live` is
`wrangler versions deploy <id>@100% --yes`, the alias move. The token
is `CLOUDFLARE_API_TOKEN` from the environment (GitHub Actions), else
wrangler's own login (production from the MacBook, J274); it is never
in argv and child output is printed redacted.

**Staging alignment.** Dispatch `server-release.yml` on main with
`-f build=<sha>` only for a published exact green `release/vX.Y.Z`
head whose packs are ready. The source selector verifies that branch
and its own CI; ordinary main CI never advances staging. The build
must descend from the current staging build (J234). Production is
selected by its version tag and cannot be aligned by hand.

An abandoned, unmerged staging release may advance to a newer prepared
release whose source cut is the same or a descendant on published main.
Both release tips must remain published under their matching version
branches, with only version/changelog changes from their cuts; a manifest
change beyond its version, release-only code, an older version or older
source cut is refused. Exact branch CI and packs-first still apply.
Production retains the commit-ancestry rule.

Every run signs with main's current publisher, checked out at the root,
and builds the bundle in the source's own tree under `./source`. So a
late CI event for an older commit still meets the packs gate and the
fix-forward rules. A tag push runs the workflow file at its tag, so a
tag on a commit from before this rule would run that commit's old
publisher, which has no production gate. Never tag one.

A `vMAJOR.MINOR.PATCH` tag qualifies for production when its peeled
commit is reachable from its published release branch or main and has
exact-head green CI for that source. The producer waits for that proof,
then preserves the packs-first and fix-forward gates. Dry-run branches
and tags never publish a channel.

J205 reserves live production for humans. Agent proofs, bots and soaks
use the signed staging channel, its exact matching client/server build,
the separate staging page origin and `saves_staging`. Today's staging
socket is `wss://rooms-staging.wildshard.io` (production's is
`wss://rooms.wildshard.io`); their `/health` stays on the tailnet (D7). A production tag or
successful producer is not permission for an agent to join production.
Local isolated producer/codec tests do not connect to either live server.

Staging assets live on prerelease tag `server-staging-<full SHA>`;
production assets live on the pushed version tag. The archive is
`engine-server-<full SHA>.tar.gz`. Sorted entries, normalized ownership
and timestamps, and `gzip -n` make retries reproducible on the runner.
An existing tag must resolve to that SHA and an existing asset must have
the same digest. CI never overwrites a differing asset.

Production verifies the remote version tag before creating its release
record and leaves `target_commitish` unset. An explicit target that differs
from main under `.github/workflows/` can require workflow-write permission.
v0.1.6 release creation returned 403 with Contents write enabled. The same
workflow uploaded and signed successfully after a maintainer created the
record with `gh release create --verify-tag`. Staging still supplies its
SHA when creating its auxiliary tag.
[GitHub release creation](https://docs.github.com/en/rest/releases/releases#create-a-release)

The signed body has `channel`, monotonically increasing `serial`,
`engineBuild` (the full source SHA), `saveEpoch` from root
`save-epoch.json` (at least 1), pinned `shards`, `bundle` (`name`,
`sha256`) and `socket`. The envelope is `{body, signature}`: the body is
the exact JSON string signed with Ed25519 and the signature is hex.
Both existing engine readers authenticate that string before parsing it.
`bundle.name` includes `<tag>/<archive>`, relative to C25's default
`https://github.com/project-wildshard/engine/releases/download`.

Channel objects are `staging.json` and `production.json` at the root of
`wildshard-releases`, with `Cache-Control: no-store`. The producer
authenticates the previous object, chooses `serial + 1`, and uses its
ETag in `If-Match` (`If-None-Match: *` on first publication). A concurrent
change retries against the newly signed object. Identical publication is
a no-op; serial and epoch never go backwards. See R2's
[conditional-write extensions](https://developers.cloudflare.com/r2/api/s3/extensions/)
and [consistency contract](https://developers.cloudflare.com/r2/reference/consistency/).

## Configuration Jake supplies

No repository settings or secrets are created by this change.

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `E7_RELEASE_SIGNING_KEY` | Ed25519 private key, PKCS8 PEM; dedicated release-signing material supplied by Jake |
| Variable | `E7_RELEASE_PUBLIC_KEY` | Matching public key, SPKI DER encoded as hex |
| Variable | `E7_STAGING_SOCKET` | Current public staging `wss://` tunnel URL |
| Variable | `E7_PRODUCTION_SOCKET` | Current public production `wss://` tunnel URL |
| Variable | `E7_STAGING_SHARDS` | Optional comma-separated pinned slugs |
| Variable | `E7_PRODUCTION_SHARDS` | Optional comma-separated pinned slugs |
| Secret | `R2_ACCOUNT_ID` | Existing R2 account identifier |
| Secret | `R2_PACKS_ACCESS_KEY_ID` | Existing scoped packs writer access key ID |
| Secret | `R2_PACKS_SECRET_ACCESS_KEY` | Existing scoped packs writer secret |
| Secret | `R2_RELEASES_ACCESS_KEY_ID` | Object Read & Write access key for `wildshard-releases` |
| Secret | `R2_RELEASES_SECRET_ACCESS_KEY` | Matching scoped secret |
| Variable | `R2_BUCKET_PACKS` | `wildshard-packs` |

Unset or empty shard variables select `driftwood-isle,nalati-grasslands`;
revisions come from `test/pins/shardfiles.json`. A missing production
socket fails instead of borrowing staging's socket. The private key must
derive the configured public key; a mismatch fails before any upload.
Use that public key for the server's `RELEASE_PUBLIC_KEY` and the online
client's `releasePublicKey` configuration. Key rotation requires a
separate coordinated consumer change; replacing this secret alone fails
when the stored object has the previous signature.

The public packs origin is `https://packs.wildshard.io`: the
`wildshard-packs` R2 bucket on its custom domain, behind Cloudflare's
CDN, with CORS for the page's origin set on the bucket. It serves the
pack books and parts. `https://releases.wildshard.io` serves signed channel
objects, placements and the item catalogue. ST27's
page/pack producer must use the same full SHA as its `engineBuild` and
supply the corresponding server pack book before a sitting can move.
This CI job does not cook or publish packs, configure tunnels, change
CORS, run setup, or prove the VPS transition. Those remain the E7
plan's external work.

For that coordinated page build, set `WS_BUILD_ID` to the full source SHA
when invoking `src/scripts/build-app.mjs`; use the identical SHA with
`src/scripts/build-server.mjs --build`. `version.json`, the document stamp,
the server bundle and the signed release then name one build. Without
an explicit value, page builds retain their short-SHA plus timestamp ID.

Before stripping the page's source maps for the deploy, run
`node src/scripts/sentry-maps.mjs dist --environment staging` (or
`production`) from the same checkout: it creates the Sentry release
`wildshard@<version>`, uploads the hidden maps under the build id as
dist, and records the deploy (SENTRY-TRIAGE S5). It reads
`SENTRY_AUTH_TOKEN`, else `~/.config/wildshard/sentry-auth-token`, and
uploads nothing without one. The Workers host's `package` step runs it
for every channel, then strips the maps.

## Local proof

`node src/scripts/vitest-tmp.ts run test/server-release-ci.test.ts` generates
an ephemeral in-memory key and verifies complete staging and production
files with the real server reader and WebCrypto reader. It rejects
tampering and epoch zero. A local HTTP S3 boundary with real SDK requests
proves first serial 1, one successful concurrent advancement, a 412
retry, an idempotent duplicate and refusal of an older green build. It
uses a test-owned git history and no remote credentials.

The workflow gives the source gate read permissions and the publishing
job content-write permission. Only the asset step explicitly receives
the GitHub token for writes. Signing material is passed only to preflight
and the final publisher. This follows GitHub's
[privileged workflow_run contract](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run);
the gate checks event type, repository, branch and exact SHA before the
publishing job receives credentials.
