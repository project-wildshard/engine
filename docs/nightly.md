# Ring 2 nightly

`.github/workflows/nightly.yml` runs at 07:17 UTC daily and by manual
dispatch. It checks the event's exact commit, never a later moving main.
It reads the committed 28 heads in `test/pins/shardfiles.json` and the
existing `test/pins/ring-2-tests.json`. Updating pins is a separate reviewed
change: a nightly does not silently substitute live catalogue heads.

No secret needs setting. All dependencies and immutable tarballs are
public. The built-in read-only `GITHUB_TOKEN` reads prior Actions reports;
there is no app credential, shard repository checkout, deployment,
nightly branch update or automatic tag. Promotion owns releases (J184).

## Work and evidence

- One Linux job installs all pins, generates inputs, runs the kit checks
  and the full admitted Vitest suite, including the slow Ring 2 list.
  Every listed file must actually execute at least one passing assertion.
  Missing files, skipped assertions and a nonzero suite exit are red.
- Eight jobs split the 28 heads into four groups of seven for Chromium
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

The scheduled workflow has no write permission and never calls that
helper. This preserves J184's promotion ownership while making J167's
refusal explicit. This workflow does not configure repository rulesets
or claim to prevent a human from bypassing the documented release rule.

## Cost and bounds

Estimate, pending the first hosted measurement: **45–60 minutes elapsed,
180–220 aggregate runner-minutes per night**. The eight product jobs have
a 75-minute hard limit, tests 35, plan/report five each. Cold cooks have a
300-second worker limit and a 330-second parent limit per head. Missing
work after a job timeout remains red in the final report.

This is a public repository. Standard hosted Linux and macOS minutes are
[free without a minute cap](https://docs.github.com/en/actions/concepts/billing-and-usage).
No larger runner, self-hosted public runner or paid service is selected.
Only immutable pin tarballs use the Actions cache, approximately 1.1 GB
per OS (about 2.2 GB total), within the
[10 GB cache allowance per repository](https://docs.github.com/en/actions/reference/limits).
Cold cook results are never reused while cook cache safety P5/P6 is open.

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
