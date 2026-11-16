# pnpm pins removes out/ products no pin names (buddy-engine, J389)

- opus-bugfix2, 23:04 UTC: after the Brasscap rename, a worktree's
  stale `out/blender-template` survived `pnpm pins`. Land's gen:inputs
  then stopped with "out/ holds pinned products the pins no longer
  name", and only a hand `rm -rf` got past it.
- `pnpm pins` rewrote the public/ mounts from its ledger, but it never
  looked at out/ folders it hadn't installed this time.
- Now a full install, fresh or reused, calls `pruneStalePinProducts`,
  which removes exactly the folders `stalePinProducts` names, the same
  list gen:inputs refuses on. So: only under out/, only folders with a
  pin receipt, and a current format-dependency product stays. It prints
  one line per folder removed. `--from-format` and named installs don't
  prune, since they add beside the rest on purpose.
- Test in `test/stale-pins.test.ts`: red first (no such export), then
  green. A real `pnpm pins` with a fake stale `out/zz-buddy-stale`
  removed it on both the fresh and the reuse path.
