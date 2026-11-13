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

The order is: publish the build's server book and parts (the staging
page/pack publish), then sign the release file (this workflow), then the
server moves (its poller preloads, counts down 60 s and restarts), then
alias the staging page to the same build. If a step fails, the previous
signed file stays live and the server keeps serving it.

**A placed cell is not a release (SA33).** A new slug the API places on
the grid (SA30) reaches a running `WORLD_CELLS=grid` server through a
second signed file, the placement file (`placementFile.ts`): `channel`,
`serial` and `cells` (`instance`, `slug`, `cell`), signed with the API's
own placement key, never the release key, which vouches for the bundle.
The server reads it at `PLACEMENT_URL` with `PLACEMENT_PUBLIC_KEY` (both or
neither) at boot and each minute, places each new cell on an empty spot,
preloads its pack from this build's book (a cell with none waits for the
next look) and opens it on a worker of its own: no grace, no restart, and
no other cell is touched. `/health` says `placements: <serial>`.

## Page release

The channel pages ship with one committed script, in four phases, from
one clean release clone per channel at the exact SHA (never a worktree
with untracked pins, never the canonical checkout):

```
node scripts/page-release.mjs staging build|upload|check|go-live
node scripts/page-release.mjs production build|upload|check|go-live --after-staging-proofs
node scripts/page-release.mjs preview build,upload,check,go-live
```

A comma list runs the phases in order and stops at the first failure.
Every channel's page is a Cloudflare Worker (OFF-VERCEL OV6 preview,
OV7 staging, OV8 production), so `--host` has one value, `workers`, the
default. `preview.yml` runs preview hourly for the newest green main (OV6).
Preview is the solo game: no release file, no packs and no gate, so
its `check` compares bytes and its `go-live` moves the alias.

| Phase | Does | Never |
| --- | --- | --- |
| `build` | `pnpm build:game` with `WS_BUILD_ID=<sha>`, `WS_RELEASE=1`, `WS_CHANNEL=<channel>` (old builds carry from the channel's own domain, OFF-VERCEL OV3) and `WILDSHARD_RELEASE_URL=https://packs.wildshard.io/releases/<channel>.json` (PACKS-CDN PC3), then the host's packaging. The build fails above 90,000 files or any file over 25 MiB (Workers static-asset limits; source maps not counted). Checks the output names this build, this channel's release file and key, and not the other channel's file. | uploads |
| `upload` | The server book and parts to the packs bucket, parts first and the book last, each read back through `packs.wildshard.io` with the channel page's `Origin` (CORS). Existing objects must have the same bytes. Each read adds a fresh query, because the CDN caches 404s. Then the page, unaliased. | moves the alias |
| `check` | The uploaded page's `version.json`, `index.html`, `sw.js` and `deploy-chunks.json` equal the local build; the packs answer with CORS; then waits (`--wait=<minutes>`, 45) until the signed release file names this build, epoch and channel socket and the channel's tailnet `/health` shows this build at that serial. | moves the alias |
| `go-live` | Re-reads the signed file and `/health` and refuses unless they still match, then moves the alias (last) and waits for the domain to serve the build. | runs without a fresh match |

Each phase refuses until the one before it has run for the same SHA
(results in `<clone>/tmp/page-release/<channel>-<sha>.json`). Production
`check` and `go-live` also need the `v<version>` tag on origin at this
SHA and `staging.wildshard.io` already serving it; `go-live` needs
`--after-staging-proofs`, which says the strict staging proofs passed:
`e7-doctor-proof.mjs` 7/7 and `e7-live-staging-proof.mjs` on Chromium
and WebKit. J205: the script opens no socket; production's own proof is
`e7-doctor-proof.mjs <origin> <sha> <key> --human-static`. The scratch
scripts' `/api/*` 401 checks are gone: the page's API is
`api.wildshard.io` (API-CLOUDFLARE AC11), not the page host.
If go-live fails after an `ALIAS MOVED` line, the alias did move; fix
forward (J179).

`--dry-run` prints every step with the token as `<token>`, reads the
live signed file and `/health`, and lists what would refuse today. It
builds, uploads and aliases nothing.

The order of one release: `staging build`, `staging upload` (packs
before the producer signs, J234), CI and Ring 1 green, the producer
signs the next staging serial, `staging check`, `staging go-live`,
strict staging proofs, `release.sh vX.Y.Z --finish` (the tag signs
production), `production build` and `upload` (any time after the
build is green), `production check`, `production go-live
--after-staging-proofs`, then `--human-static`.

Pack writes use `wrangler r2 object put` with wrangler's login.

The host is `scripts/page-release/hosts/workers.mjs` (OFF-VERCEL OV4), the
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

**Staging alignment.** Run this workflow by hand (`workflow_dispatch`) on
main with `build` set to a full green main SHA whose packs are published:
`gh workflow run server-release.yml --ref main -f build=<sha>`. It signs
that build as the next staging serial. This is how a held build goes
live once its packs land. It is forward-only (J234, Jake: "Fix forward.
We have to fix forward. I guess a one-time rollback is fine"): the build
must descend from the one staging names, or the run fails. The one
rollback was staging serial 65 to `a8144a5` on 2026-11-10. It signs
with main's tooling, but rebuilds the bundle in the named build's own
tree and refuses unless it matches the asset already on its
`server-staging-<sha>` tag, so a replaced archive is never signed. The
packs gate still applies, CI and Ring 1 must be green for that SHA, and
production can never be aligned.

Every run signs with main's current publisher, checked out at the root,
and builds the bundle in the source's own tree under `./source`. So a
late CI event for an older commit still meets the packs gate and the
fix-forward rules. A tag push runs the workflow file at its tag, so a
tag on a commit from before this rule would run that commit's old
publisher, which has no production gate. Never tag one.

A `vMAJOR.MINOR.PATCH` tag qualifies for production. Its peeled commit
must belong to main and have the same two green main-push workflows. A
tag arriving while they run waits up to 40 minutes. A red result fails;
rerun that tag's server-release workflow after its main CI succeeds.
Tags from before this producer existed are ignored. No manual promotion
or second channel-writing workflow should race this producer.

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

Channel objects are `releases/staging.json` and
`releases/production.json`, with `Cache-Control: no-store`. The producer
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
CDN, with CORS for the page's origin set on the bucket. It serves these
paths; the channel objects are `no-store` and never cached. ST27's
page/pack producer must use the same full SHA as its `engineBuild` and
supply the corresponding server pack book before a sitting can move.
This CI job does not cook or publish packs, configure tunnels, change
CORS, run setup, or prove the VPS transition. Those remain the E7
plan's external work.

For that coordinated page build, set `WS_BUILD_ID` to the full source SHA
when invoking `scripts/build-app.mjs`; use the identical SHA with
`scripts/build-server.mjs --build`. `version.json`, the document stamp,
the server bundle and the signed release then name one build. Without
an explicit value, page builds retain their short-SHA plus timestamp ID.

Before stripping the page's source maps for the deploy, run
`node scripts/sentry-maps.mjs dist --environment staging` (or
`production`) from the same checkout: it creates the Sentry release
`wildshard@<version>`, uploads the hidden maps under the build id as
dist, and records the deploy (SENTRY-TRIAGE S5). It reads
`SENTRY_AUTH_TOKEN`, else `~/.config/wildshard/sentry-auth-token`, and
uploads nothing without one. The Workers host's `package` step runs it
for every channel, then strips the maps.

## Local proof

`node scripts/vitest-tmp.ts run test/server-release-ci.test.ts` generates
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
