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

**Staging signs packs-first.** Jake, 2026-11-10: "staging needs to be
healthy. we can't show these half-assed, half-open, half-closed failure
states." The running server loads the named build's server book and parts
before its grace, and stays on its old build while they are missing. So a
staging file that names a build with no book strands the server, the page
and every doctor check behind it (serial 63 named `b721769` while its book
was 404 and the server sat on `a8144a5`). Before signing a staging file,
`publish.mjs` reads `assets/spawn/server-<build>.json` from the bucket and
heads every part the release's pinned shards and the grid name. If any is
missing the run reports `held`, with a notice, and the channel keeps naming
the last build whose packs are published. `test/server-release-ci.test.ts`
proves held, published and the rollback below against a real S3 boundary.

The order is: publish the build's server book and parts (the staging
page/pack publish), then sign the release file (this workflow), then the
server moves (its poller preloads, counts down 60 s and restarts), then
alias the staging page to the same build. If a step fails, the previous
signed file stays live and the server keeps serving it.

**Staging alignment.** Run this workflow by hand (`workflow_dispatch`) on
main with `build` set to a full green main SHA whose packs are published:
`gh workflow run server-release.yml --ref main -f build=<sha>`. It signs
that build as the next staging serial, newer or older than the current
one, using main's tooling and the bundle already on the build's
`server-staging-<sha>` tag. This is how a held build goes live once its
packs land, and how staging rolls back to its last good build. The packs
gate still applies, CI and Ring 1 must be green for that SHA, and
production can never be aligned.

A `vMAJOR.MINOR.PATCH` tag qualifies for production. Its peeled commit
must belong to main and have the same two green main-push workflows. A
tag arriving while they run waits up to 40 minutes. A red result fails;
rerun that tag's server-release workflow after its main CI succeeds.
Tags from before this producer existed are ignored. No manual promotion
or second channel-writing workflow should race this producer.

J205 reserves live production for humans. Agent proofs, bots and soaks
use the signed staging channel, its exact matching client/server build,
the separate staging page origin and `saves_staging`. Today's staging
socket is `wss://wildshard.tailb41b20.ts.net:8443`. A production tag or
successful producer is not permission for an agent to join production.
Local isolated producer/codec tests do not connect to either live server.

Staging assets live on prerelease tag `server-staging-<full SHA>`;
production assets live on the pushed version tag. The archive is
`engine-server-<full SHA>.tar.gz`. Sorted entries, normalized ownership
and timestamps, and `gzip -n` make retries reproducible on the runner.
An existing tag must resolve to that SHA and an existing asset must have
the same digest. CI never overwrites a differing asset.

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

Configure the existing public packs origin to serve these paths and
allow the page's origin through CORS. ST27's page/pack producer must use
the same full SHA as its `engineBuild` and supply the corresponding
server pack book before a sitting can move. This CI job does not cook or
publish packs, configure tunnels, change CORS, run setup, or prove the
VPS transition. Those remain the E7 plan's external work.

For that coordinated page build, set `WS_BUILD_ID` to the full source SHA
when invoking `scripts/build-app.mjs`; use the identical SHA with
`scripts/build-server.mjs --build`. `version.json`, the document stamp,
the server bundle and the signed release then name one build. Without
an explicit value, page builds retain their short-SHA plus timestamp ID.

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
