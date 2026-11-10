# VITEST-BENCH VB1: a per-file Vitest benchmark harness

Jake, 2026-11-10: "restrict the Vitest in engine to just 2 cores, and then
they can go one file at a time. Benchmark each one." The plan is meta
`docs/plans/VITEST-BENCH-PLAN.md`.

`scripts/vitest-bench.py run` measures one file at a time on one worker. It
is the machine's lowest-priority caller: it starts a file only while no
full-test lease is held or queued and nobody else waits for CPU-broker slots,
holds a 2-slot grant through `cpu-admission.py hold` (so the grant dies with
it), and the moment a gate or another caller appears it freezes and kills the
file's whole tree, gives the grant back and measures the file later. Any file
is killed at 150 s, well inside the broker's five-minute admission deadline.

Why so strict: in the first pass, `--cpu-prof` deadlocked one Vitest main
process inside OpenSSL's provider lock while it held its grant, and a queue
gate's all-slot `cook-cpu-limit` file waited past five minutes and went red.
Profiling is now default-deny: the Vitest config reaches OpenSSL in every
file, so `--profile` also needs `--profile-accept-openssl-risk`.

Per file it records wall from the grant (queueing apart), user and system CPU
of the whole tree from `wait4` (which counts every reaped descendant), max RSS,
peak tree RSS and child processes from a `ps` sampler, Vitest's own file time
and cases, and with `--profile` V8 self time per function and by code origin.
Vitest stops forks with SIGTERM, which skips the profile write, so processes
whose entry resolves inside the checkout's Vitest package alone get the
exit-on-SIGTERM preload Vitest itself installs for `--cpu-prof`
(nodejs/node#55094). SIGTERM to the bench kills its file and releases the
grant through the broker's own pipe. Discovery (`vitest list`) runs the same
supervised way, since it loads the Vitest config too. One residual: a child
that deliberately calls setsid() and is never sampled can escape cleanup.
Teardown kills and verifies within an absolute budget, then returns the grant
unconditionally: a gate waiting on the broker outranks cleanup verification.
Survivors were SIGKILLed and are reported after the grant is back.

`observe` is a passive census of a real push gate's process tree: wall, user
and system CPU, average and peak parallelism, memory and processes by kind.
It runs nothing, so it never costs a gate. `table` ranks files; `pack` packs
measured walls longest-first onto N workers.

It is tooling only: no test, config, cap or source change. CPU agrees with
`/usr/bin/time -l` on the same file within 5 %.
