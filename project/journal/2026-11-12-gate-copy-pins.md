# Gate copy pins (opus-gatefix)

> Written by: Claude

- Every mode-1 push from the canonical checkout was refused after a green gate: "the gate changed 3 file(s)",
  the boot `*.generated.ts` stamps. The canonical checkout had no `out/.pins-manifest.json` (a partial pins run
  at 15:52 dropped it), so `verifiedPinsOutputs` lent the copy no mounts, and `gen:inputs` in the copy stamped
  `cloud-field.bin` and friends out of the tables.
- Fix: `makeGateCopy` runs `pnpm pins` in the copy (about 12 s) whenever the copy holds no verified pins outputs,
  and reinstalls offline (0.5 s) when a cloned pnpm link does not resolve at the copy's deeper path.
