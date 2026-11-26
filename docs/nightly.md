# Ring 2 nightly

`.github/workflows/nightly.yml` runs at 02:17 Cancún daily and by manual
dispatch. It checks the event's exact commit, never a later moving main.
It reads every committed head in `test/pins/shardfiles.json` and the
existing `test/pins/ring-2-tests.json`. Updating pins is a separate reviewed
change: a nightly does not silently substitute live catalogue heads.

Refresh staging independently with `node src/scripts/pins.ts refresh --channel
staging`. Review and commit `test/pins/staging.json`; its catalogue and pins
come from `GET /api/catalogue.json?channel=staging`. Dispatch `ci.yml`
(Ring 1) or `nightly.yml` (Ring 2) with `pins_channel=staging` to select
that committed snapshot in each disposable test checkout. Ring 1 re-cuts
its slices from those heads. Ordinary pushes and the schedule keep their
production pins. Local selection is `node src/scripts/pins-staging.ts select`;
it replaces `shardfiles.json` and `catalogue.json`, so use a disposable tree.

The snapshot's `catalogueHash` detects mismatched inputs; `releaseHash`
is the live catalogue's `x-wildshard-release-hash` (api-server AP-26: the
sha256 of the placement file body the staging row names). A staging-pinned
nightly runs `node src/scripts/pins-staging.ts verify`, which refuses when the
live release has moved past the committed snapshot; refresh it then.

Ring 2's dependencies and immutable tarballs are public. Its built-in
read-only `GITHUB_TOKEN` reads prior Actions reports. After Ring 2 is
green, Ring 3 uses the dedicated nightly App described below. There is
no deployment, nightly branch update or automatic tag. Promotion owns
releases (J184).

## Work and evidence

- Four Linux jobs install all pins, generate inputs and run the kit checks.
  Three partition ordinary Vitest files with `--shard=1/3` through
  `--shard=3/3`. The fourth runs the three native contention files with
  one worker. Together they run the full suite, including the Ring 2 list.
  Every listed file must actually execute at least one passing assertion.
  All partition receipts are required; a missing or duplicate partition,
  overlapping test files, skipped listed assertions or a nonzero exit is
  red. Verdict version 2 includes each partition's file/assertion counts;
  old verdicts remain usable only as failure-diff baselines. Each process
  keeps its existing 25-minute limit (jobs: 35 minutes including setup).
  A manual `suite_only=true` dispatch diagnoses just these jobs, produces
  no qualification verdict and uses its own concurrency group.
- At most four head jobs run at once. WebKit uses four macOS groups.
  Chromium uses four Linux groups and two macOS groups. Pine Hollow
  has its own Metal job, and Nine Dragon Stack and Nalati share the other.
  Each builds the full catalogue, then cold-cooks its heads through the
  production bounded cook worker. Failed heads do not stop later heads.
- Each head's generated bank entry is removed before the production
  `addStoredShards` installer attaches that exact cook. The real phone
  title enters gameplay with Runtime packs enabled. Grid-only heads have
  no picker card: those use the real session travel-handoff schema as an
  arrival fixture, then must reach the same actual gameplay checks. This
  proves the product boot, not road travel or picker eligibility. A boot must fetch
  client `.pack.br` bytes from this cook's store, not just its metadata.
  HTTP errors, fatal reports, black frames and wrong worlds remain red.
- That actual gameplay page taps the hover control to mount and unmount,
  and observes 30 completed engine frames. Explorer separately renders
  and checks the head's real catalogue thumbnails, including an explicit
  empty catalogue where that is the authored contract. Each native context
  is fresh; WebKit never invokes Chromium-only CDP storage commands.
- The hosted draw census records real full-frame calls, including post
  and shadow passes. Its 150-call comparison is **report-only**, not an
  official GPU or iPhone performance qualification (J169). A missing
  census is incomplete coverage; exceeding 150 is reported, not failed.

The job summary and `nightly-verdict` artifact name each head, full pin
hash, browser and failed phase. Shared test failures are labelled shared,
not attributed to an invented head. Receipts checkpoint atomically after
each phase. Missing, stale or duplicate receipts hold the verdict red.
The previous completed nightly's verdict, including a red one, supplies
the new/existing/resolved comparison. An unavailable or expired baseline
is stated plainly; current failures still hold the tag.

## Cook cache: TC28

TC28's `cook-cache` job runs on scheduled nights and explicit
`cook_cache_only=true` dispatches. It is report-only under J186; its
artifact must say `complete:true` before anyone claims the proof passed.
The dispatch skips the ordinary suite, head matrix, verdict and Ring3,
uses its own concurrency group, and cannot qualify a full night/release.

The quick three-case proof checks every cook input (including a newly
imported input), a persistent hit through a fresh worker with a counting
child, two revisions' own headers and an interleaved GC. It runs outside
hooks. The hosted-only companion runs actual prime/reused/independent
cold Template2 cooks through the bounded worker and real simulation
prover, checks unchanged encoder-cache inode/timestamp/body identities, and compares product keys and byte
hashes plus every server file and the full index except elapsed time.
It rejects retries, records time/RSS, verifies the quick receipt, and
refuses a local invocation. J370 keeps unmeasured proof legal. New tests
need their own green week before an explicit admission decision.

## TC22: the release entry reads the latest nightly

Engine's pre-push reads version tags through `src/scripts/release-nightly.ts`.
This covers the current branch-based release helper, which pushes its
exact green release tag without calling the legacy release-check entry.
The guard downloads the latest completed scheduled main nightly's
`nightly-verdict` artifact (production pins). It refuses `newFailures` before
using a cached full check or starting a fresh one. Missing artifacts,
malformed reports and mismatched run/source identities also hold release.
Ordinary pushes and deleted tags keep their existing checks. The legacy
`src/scripts/release-check.mjs` also calls the guard before cached or fresh
checks; its `--probe` only queries the local cache and cannot release.

Under J370, existing failures alone pass this automatic check. J167's
any-red check below remains manual until the first full green night;
this change does not qualify a red night. The selected scheduled run must
have its full verdict; manual staging or diagnostic runs cannot clear release.

The explicit `node --test src/scripts/release-nightly.proof.ts` plants a new
failure through the actual pre-push and local bare origin, proves no tag
reaches origin or the full gate, and checks missing/stale reports,
existing failures, ordinary pushes, cache-entry refusal and cleanup.
CI observes it without blocking; admission review is no earlier than
2026-11-23, after a real week, and requires an explicit decision.

## J167: a red nightly holds the tag

Read the **report job**, not one green matrix leg. Red or incomplete
coverage means **HOLD**, including an otherwise successful test process
that omitted a listed journey. Fix forward (J165/J179).

Before promotion, download the green run's `nightly-verdict` artifact and
run this from the exact release checkout:

```sh
node src/scripts/nightly.ts guard /path/to/nightly-verdict/verdict.json
```

It refuses a different commit, pin digest, test list or incomplete set of
head/browser/phase receipts. Failed, skipped or cancelled upstream Actions
jobs also hold the verdict, even if their uploaded phases passed. The
head runner refuses a stale local build before launching a browser.
A green old nightly never clears a new
commit. The optional legacy patch-tag helper also requires this verdict:

```sh
node src/scripts/nightly-tag.mjs --report=/path/to/verdict.json
```

Both commands read the latest completed hosted nightly using the existing
`gh` login's public Actions read access. The downloaded run ID must match
that successful run and its exact commit. A later red night on the same
commit cannot be cleared with an older green artifact. No new credential
is created; unavailable history refuses promotion.

The scheduled workflow's built-in token has no write permission and never
calls that helper. This preserves J184's promotion ownership while making J167's
refusal explicit. This workflow does not configure repository rulesets
or claim to prevent a human from bypassing the documented release rule.

## Ring 3 sender

After the report job passes, nightly calls `ring-3.yml` with its exact
engine SHA. That workflow can also be dispatched alone on a plan branch
to prove sender configuration without waiting for a full night. Before
the new workflow is on main, dispatch the existing `nightly.yml` on the
plan branch with `ring3_only=true`. That diagnostic skips Ring 2, produces
no nightly verdict and cannot qualify a release. The sender calls
all seven shard `ci.yml` receivers with `workflow_dispatch` and the full
`engine` input. Their existing `engine-candidate` repository-dispatch
entry remains available and reaches the same candidate selection code.

The dispatch requests `return_run_details`, then follows those exact run
IDs; it never substitutes the latest run of a shard's moving main. This
is the documented [workflow dispatch response](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
The aggregate records each receiver's actual shard commit, run link and
conclusion. All seven must succeed; a timeout, cancelled run, changed run
identity or dispatch refusal holds qualification. Each red receiver gets
one issue per engine candidate in that shard; repeated reds reuse it.

`NIGHTLY_APP_CLIENT_ID` and `NIGHTLY_APP_PRIVATE_KEY` already exist on
engine. The App must be installed on the seven shard repos with Actions
write (dispatch and read runs) and Issues write. The workflow requests a
token scoped to exactly those seven repos. It never changes installation
permissions, org variables or secrets. If the second App is still scoped
to engine only (Q25), its installation needs Jake's decision; the token
step stays red with a pending aggregate until then.

`ring-3-verdict` is a compact release qualification artifact, not a
published release. Its JSON and Markdown are retained for seven days.
No tag, release, shard upload, cook or deployment is run by this sender.
The twenty-minute sender deadline includes queued receivers; each shard
keeps its own existing candidate-job limits.

## Cost and bounds

Estimate, pending the first hosted measurement: **45–60 minutes elapsed,
180–220 aggregate runner-minutes per night**. The eight product jobs have
a 75-minute hard limit, tests 35, plan/report five each. Cold cooks have a
production `DEFAULT_LIMITS.seconds` allowance (currently 600 seconds),
with another 30 seconds for parent cleanup per head. The earlier private
300-second cap predated the cold phone ASTC work. Missing
work after a job timeout remains red in the final report.

This is a public repository. Standard hosted Linux and macOS minutes are
[free without a minute cap](https://docs.github.com/en/actions/concepts/billing-and-usage).
No larger runner, self-hosted public runner or paid service is selected.
Only immutable pin tarballs use the Actions cache, approximately 1.1 GB
per OS (about 2.2 GB total), within the
[10 GB cache allowance per repository](https://docs.github.com/en/actions/reference/limits).
Cold cook results are never reused while cook cache safety P5/P6 is open.
Successful client-build encodes are input-addressed and checkpointed
before head proofs, so a red head does not leave the next WebKit build
cold. They are shared across Linux and macOS; the independent cold
worker stores and worker phone encodes remain fresh.

Artifacts retain compact JSON and Markdown for seven days. No builds,
tarballs, packs, browser profiles or screenshots are uploaded. Budget
under 1 MB per night, under 7 MB retained; this does not claim anything
about other workflows' use of the shared artifact storage allowance.
Phase wall times and cook seconds are retained to replace the estimate
with observed hosted consumption after the first scheduled run.

## Local checks

The quick refusal checks run explicitly in the nightly plan job and stay
outside hooks and Vitest discovery (J186):

```sh
node --test src/scripts/nightly.proof.ts
node --test src/scripts/ring3.proof.ts
actionlint .github/workflows/nightly.yml
```

The same real product path can be run locally, with the shared machine
leases, after `pnpm build:game`:

```sh
src/scripts/browser-lane.sh node src/scripts/nightly-heads.ts chromium 0
src/scripts/browser-lane.sh node src/scripts/nightly-heads.ts webkit 0
```

Groups 0–3 cover all heads; `node src/scripts/nightly.ts plan` prints their
membership. An optional final slug limits a local diagnostic to a member
of its partition; its partial receipt can never clear a nightly verdict.
Use separate report directories for separate local diagnostics. A
hosted checkout runs exactly one partition and is discarded afterwards.

## Coverage fault drill

TC26's nine positive contracts run explicitly, outside hooks and
Vitest discovery:

```sh
node --import ./src/scripts/bake-loader.mjs --test test/ci/coverage-fire-drill.proof.mjs
```

They use pinned Nalati and Template, native physics, the installed format's
handwritten product, real save/restore, the Ring 1 input reader and a retained
seven-receiver verdict. Controlled positions isolate real approach and door
inputs; no trust, reward or script field is assigned. This is not a walked
journey. Each complete case keeps 9.5 seconds including cleanup. CI runs the
positive cases non-blocking after its blocking wall check. Promotion requires
matching hosted green observations spanning seven days, with no intervening
observed failure. Collect actual run/job/log evidence with:

```sh
node src/scripts/coverage-soak.mjs tmp/coverage-soak
```

From a committed checkout with pins and generated inputs installed, run
`node src/scripts/coverage-fire-drill.mjs tmp/coverage-fire-drill` manually.
Its eight plants cover taming, the actual door scene, a supplemental outside
author export, a required format field, an absent real section, a truncated
real tar, saved door state and release-hold loss. Each needs baseline green,
a specific assertion/admission red, and healed green. Timeouts and process
failures refuse qualification. Only an owned frozen export is mutated;
installed packages and pin caches stay immutable.

The removed-export and lost-auth owner proofs use the actual Dunes boundary
checker and API accounts/me route test in isolated exports:

```sh
node src/scripts/coverage-owner-drill.mjs ../api-server ../shard-dunes tmp/coverage-owners
```

The owner receipt records each repository's tested SHA and responsible fix
path. The seven-shard hold proof replays the real retained Ring 3 artifact;
it does not dispatch fresh receivers or qualify a current release candidate.
The page-census fault uses row 32's recorded BUG28 witness, rather than a new
graphical capture in this campaign.

Only the public Linux Actions worker runs the cold cook portion:
`node src/scripts/coverage-cook-drill.mjs tmp/engine-boundaries/cook-drill`.
It uses three independent cold stores, a real byte-producer edit, production
part-diff reporting, healed byte equality and rejection of a stale result.
The runner refuses a local invocation. These scripts retain receipts/logs
in their requested repo tmp directory and clean their private exports.

## Single-head diagnosis

Dispatch `nightly.yml` on the candidate branch with `diagnostic_head`
set to a committed slug and `diagnostic_browser` set to `chromium` or
`webkit`. It validates
the actual pin, uses its normal nightly partition and runner, then runs the same
cold-pack and phone path for only that head. Build encodes may be reused;
the head's cook store remains cold on the hosted worker. It adds no
scheduled or ordinary push job.

The `nightly-head-diagnostic` artifact holds raw phase receipts. Diagnostic
mode skips the suites, full head matrix, verdict report and Ring 3;
it has no tag or release step and cannot qualify a full night. Full qualification still requires every
head/browser and all complete suite partitions in `nightly.yml`.

A failed hover phase keeps its original error plus before/after player
hover/blend, equipment ownership/enabled state, installed board/model,
input context/permission, frame count and clock state. The mount and
unmount assertions and their existing deadlines are unchanged.

The full nightly maps the decimal Actions run ID to its low 32 bits for
`NET_FUZZ_SEEDS`. The network fuzzer keeps its uint32 admission boundary;
the full run ID remains the report identity. Reproduce the selected seed
with `node src/scripts/nightly-seed.ts <run-id>`.

For the actual input fault drill, set `diagnostic_drill=true` beside a
diagnostic head/browser. The hosted job builds once, then cold-cooks and
boots three fresh pages: baseline, actual hover control removed, healed.
The ordinary touch assertion must reject the absent control while boot,
native draw and Explorer still pass. The production verdict compares
those real receipts and requires exactly one new hover failure, then
exactly that resolution. `drill.json` and all raw receipts are retained.
Only the selected head/browser was observed; missing coverage still
holds qualification. A driver crash/timeout cannot pass the drill.
