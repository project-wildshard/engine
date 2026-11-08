# Follow-ups on the 1353 scheduling review

**Status:** unread. Changes are committed locally; publication waits for
codex-port's production build ID.

The draw-only regression now has held and moving-frame cases. Each
completed-frame continuation still reports a spent native budget, no
other warm-up runs, and compilation advances no clock. Both atomic jobs
must finish after a yield, on distinct frames. Restoring the old endless
budget loop fails both cases immediately at the bounded pause guard.
All **103 precompile cases pass in 1.11 s**; the prior 101 are unchanged.
No renderer implementation, shader cap, fence or save epoch changed.

The real phone-sized road proofs used committed
`1353d538683eb881780b4951ce7935c6f2de66cc`, build
`1353d53-mw7k6vyc`, save epoch 1. The retained build came from the clean
published checkout. An immutable copy of its build outputs let the
release lane continue independently. Proof-script and runtime blob IDs,
artifact document digests, all six navigation build IDs, actual crossing
states and the original machine-readable bar records are retained in
[the receipt](receipts/1353d538-followups.json).

- Chromium **SwiftShader** crossed Driftwood to Ember, acknowledged its
  save, and resumed the earned Ember pose within 0.003 m. The ordinary
  return and missing-art return both had a closed board.
- Native WebKit completed the same crossing, save and two returns. Its
  three card readings had zero stalls, backwards changes, untraced
  changes or page faults.
- Chromium's separate strict GRID card result remains **red** for real
  `firstFrame` GPU stalls. Its crossing/save/return assertions passed.
  The receipt preserves exit 1 and those stalls; no exception was added.
- **Open:** hardware-GPU Chromium crossing on a hosted runner. Standard
  hosted runners cannot supply it. The Chromium result above is software;
  the local Apple GPU reading belongs to WebKit.

The installed `_template` WebKit strict case passed **10/10 independent
fresh-process runs**, after the full suite finished. Ready times were
**2.345–2.429 s, median 2.364 s**. All runs used the shardfile path and
had zero stalls, backwards changes, untraced changes or page faults.
The earlier 3.2 s observation did not reproduce; these repeats support
run/context noise. The historical 2.5/3.2 s singles lack matched load and
cache controls for estimating a code-attributed difference.

The existing `loading-card-proof.mjs` driver ran through
`scripts/browser-lane.sh`, with `--grid --dump --browser=<engine>` for
travel and `--shard=_template --browser=webkit --strict --dump` for timing.
Chromium travel additionally retained its strict card verdict. Contexts,
profiles and owned preview processes were closed after each run.

The already-in-flight nightly push landed at
`93562a42d4ad8a99da6e1fed83d0ce5f3a4c9f70` after the full normal gate
passed in 978.7 s. Codex-port received that confirmed SHA and the E541
production-check entrypoint. Further publication and hosted nightly
dispatch remain queued behind production completion.
