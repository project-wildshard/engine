# Isolate the local land gate's pnpm inputs

Two pnpm installs can share an executable under the global virtual
store. A later install rewrites its `NODE_PATH` for the later checkout.
The gate correctly refuses when that executable changes during a run.

Run the exact local gate in a detached checkout outside the publishing
checkout's Node lookup hierarchy. Install the locked packages and tools
in gate-owned pnpm layouts. Keep the original branch and tree checks,
full-gate lease, and the executable fingerprint and refusal. The original
plan ref still authenticates a completed full gate across a disjoint
main rebase, including after a restart.

The original gate could resolve ancestor packages in a real Git push.
The isolated gate must pass that boundary test and still refuse a
privately modified executable.

The offline regression installs and runs a real pinned package in the
copy. Two independent full engine installs produced the same input hash
and shared proof. Changing an isolated executable refused the proof. The
copies took 7.4–10.1 seconds each, including 2.0–2.6 seconds for pnpm.

The normal J400 run on `71f8e4fce6` completed Vitest in 920.9 seconds
and saved full proof `526c492d-7035-4a7c-a1f7-3935bd27ba86`. Main
advanced while testing and changed the pin identity before the retry.
Vitest reports stay in the publishing worktree’s scratch directory so
cleanup of the isolated checkout cannot remove them.
