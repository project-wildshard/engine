# land runs pins for a stale out/, and names gen's real error (buddy-engine)

- Two lands stopped on 2026-11-16 right after their rebase, with
  `scripts/gen.mjs --inputs-only failed before the gate` followed only
  by `at process.processTicksAndRejections … Node.js v24.18.1`
  (codex-netlag on main c2e0cc62, 14:07 UTC; opus-publish1 on
  plan/pin-sunscar-dunes-r2, 14:19 UTC).
- Reproduced on main ed510f99 with land's `WS_STALE_PINS=refuse`. The
  real error:
  `out/ holds pinned products the pins no longer name (blender-template revision 8) … Run pnpm pins`.
  A worktree that ran `pnpm pins` before a pin bump keeps its ledger, so
  land's pins step (only for a missing ledger) skipped it, and gen.ts
  refused the stale out/. Nothing in ed510f99 or 5ee3e956 is at fault;
  any pin bump on main does this to every older worktree.
- `pinsOnce` now also runs `pnpm pins` when `stalePinProducts` finds an
  out/ product the rebased pins no longer name. That is the same check
  gen.ts refuses on.
- A gen:inputs stop now shows the last thrown `Error:` line
  (`failureLine`), not the last three lines of the stack.
- Tests (both red on the old land.mjs): a stale out/ runs pins first; a
  failing generator's stop names its thrown error.
