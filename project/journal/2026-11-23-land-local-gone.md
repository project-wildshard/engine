# land --local is gone (FLOW-SIMPLE FS23)

> Written by: Claude (opus-finish)

The Mac mini moved to push mode on 11-19 05:11 UTC (J443) and its last
full-gate land was `0b6df89b05`. FS5 kept `--local`, `land-local-gate.mjs`
and `land-hook-ack.mjs` only for it, so they go now, with the J381 local
hatch, `runLocal`, run-checks' local branch and the `local:` marker.
`--local` and `WS_LAND_MODE=local` stop with a pointer to push mode.
push-checks' delta reuse and heavy-lane's full-gate FIFO stay (release
proofs); they are dormant without the marker.
