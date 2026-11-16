# Passive gate census repair

> Written by: Codex

> **State:** built locally, 2026-11-15; HOW-WE-BUILD TS12a.

`vitest-bench.py observe` now delegates to `cpu-census.py` instead of
maintaining a second PID-only sampler. The existing recorder tracks kernel
process identity, thread activity, sampled CPU deltas and observed descendants
after the root exits. It never signals a target or changes its environment.

The default discovery expression accepts relative and absolute Node gate
entry paths. It excludes a wrapper mentioning the gate in its arguments,
refuses ambiguous roots, and waits at most two minutes for an owner. An
explicit `--pid` selects one existing owner. Observation and descendant-drain
deadlines remain bounded by the recorder's original limits.

Use owned repository scratch, for example:

```sh
python3 scripts/vitest-bench.py observe --pid PID \
  --out tmp/codex-wire/census.json
```

Each observation retains its raw JSONL and writes a version-2 summary.
Sampled CPU and average/peak CPU use are lower bounds; summed RSS includes
shared pages. Short-lived children can be missed. The summary labels the
gate unverified and leaves exact gate CPU absent. It refuses old version-1
summaries because their cumulative CPU fields had different semantics.
These observations need full/split provenance and reaped-tree user/system
rusage before qualifying for TS12's ten-full-gate bar or J227's finish line.

`test/tooling/vitest-bench-observe.test.mjs` drives the real Python CLI and
kernel recorder. Its proof owns real relative/absolute Node roots, a wrapper
decoy, busy/sleeping descendants and an orphan writer. It checks bounded
missing-root refusal, ambiguous-root refusal, legacy-summary refusal, actual
CLI discovery, CPU against the busy child's independent process clock,
observed drain and an orphan's final write after observation. The fixture's
ordinary parent reaps its owner, as the real gate parent does; a retained
zombie must remain uncertain. All fixtures end and their files are removed.

The focused proof and Vitest case pass. No hook, admission lease, cap, gate
command or test assertion was relaxed. There is no speed saving claim and
no new full-gate sample from this support work.
