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
