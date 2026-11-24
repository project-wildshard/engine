> Written by: Claude (opus-grid)

# 2026-11-24: full builds restore the full-ledger spawn parts first (FS30, J505)

codex-ms found why nightly 45307397441's Chromium groups failed `pnpm build:game`: they restored only the Ring 1
subset cache and re-encoded spawn parts until the 1800 s cap, while ci's `memory-client-build` restored
`full-ledger-spawn-parts-br-v2` and built the same 453 parts with 0 encodes in 67 s. `.github/actions/full-ledger-key`
computes ci's key (this runner's and ci's ubuntu X64 one). The nightly heads and head-diagnostic, release preflight,
hover-contract and the engine-boundaries catalogue restore it first, with the old keys as fallbacks; each per-head
cold cook is untouched. `test/workflow-full-ledger.test.ts` fails any full-game job that restores spawn parts without
trying the full-ledger key first, and keeps the action's key template equal to ci's.
