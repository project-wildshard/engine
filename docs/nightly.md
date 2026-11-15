# Ring 2 nightly

`.github/workflows/nightly.yml` runs at 02:17 Cancún daily and by manual
dispatch. It checks the event's exact commit, never a later moving main.
It reads every committed head in `test/pins/shardfiles.json` and the
existing `test/pins/ring-2-tests.json`. Updating pins is a separate reviewed
change: a nightly does not silently substitute live catalogue heads.

Refresh staging independently with `node scripts/pins.ts refresh --channel
staging`. Review and commit `test/pins/staging.json`; its catalogue and pins
come from `GET /api/catalogue.json?channel=staging`. Dispatch `ci.yml`
(Ring 1) or `nightly.yml` (Ring 2) with `pins_channel=staging` to select
that committed snapshot in each disposable test checkout. Ring 1 re-cuts
its slices from those heads. Ordinary pushes and the schedule keep their
production pins. Local selection is `node scripts/pins-staging.ts select`;
it replaces `shardfiles.json` and `catalogue.json`, so use a disposable tree.

The snapshot's `catalogueHash` detects mismatched inputs; `releaseHash`
is explicitly null. api-server AP-26 exposes no public release-row hash
yet. These runs prove the selected staging inputs and do not qualify a
release against J171's signed identity. Row 23 remains open for that check.

Ring 2's dependencies and immutable tarballs are public. Its built-in
read-only `GITHUB_TOKEN` reads prior Actions reports. After Ring 2 is
green, Ring 3 uses the dedicated nightly App described below. There is
no deployment, nightly branch update or automatic tag. Promotion owns
releases (J184).

## Work and evidence

- Two Linux jobs install all pins, generate inputs, run the kit checks
  and partition the full admitted Vitest suite with `--shard=1/2` and
  `--shard=2/2`, including the slow Ring 2 list.
  Every listed file must actually execute at least one passing assertion.
  Both partition receipts are required; a missing or duplicate partition,
  overlapping test files, skipped listed assertions or a nonzero exit is
  red. Verdict version 2 includes each partition's file/assertion counts;
  old verdicts remain usable only as failure-diff baselines. Each process
  keeps its existing 25-minute limit (jobs: 35 minutes including setup).
  A manual `suite_only=true` dispatch diagnoses just these jobs, produces
  no qualification verdict and uses its own concurrency group.
- Eight jobs split the heads into four balanced groups for Chromium
  on `ubuntu-24.04` and WebKit on `macos-15`. At most four jobs run at once.
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

## J167: a red nightly holds the tag

Read the **report job**, not one green matrix leg. Red or incomplete
coverage means **HOLD**, including an otherwise successful test process
that omitted a listed journey. Fix forward (J165/J179).

Before promotion, download the green run's `nightly-verdict` artifact and
run this from the exact release checkout:

```sh
node scripts/nightly.ts guard /path/to/nightly-verdict/verdict.json
```

It refuses a different commit, pin digest, test list or incomplete set of
head/browser/phase receipts. Failed, skipped or cancelled upstream Actions
jobs also hold the verdict, even if their uploaded phases passed. The
head runner refuses a stale local build before launching a browser.
A green old nightly never clears a new
commit. The optional legacy patch-tag helper also requires this verdict:

```sh
node scripts/nightly-tag.mjs --report=/path/to/verdict.json
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
node --test scripts/nightly.proof.ts
node --test scripts/ring3.proof.ts
actionlint .github/workflows/nightly.yml
```

The same real product path can be run locally, with the shared machine
leases, after `pnpm build:game`:

```sh
scripts/browser-lane.sh node scripts/nightly-heads.ts chromium 0
scripts/browser-lane.sh node scripts/nightly-heads.ts webkit 0
```

Groups 0–3 cover all heads; `node scripts/nightly.ts plan` prints their
membership. An optional final slug limits a local diagnostic to a member
of its partition; its partial receipt can never clear a nightly verdict.
Use separate report directories for separate local diagnostics. A
hosted checkout runs exactly one partition and is discarded afterwards.
