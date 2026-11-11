# land's rebase install, ready for the store flip

Meta GVS-PLAN G9 prerequisite (opus-stamps handed land.mjs over). When a
rebase brings in a lockfile or package.json change, land runs
`pnpm install --frozen-lockfile`. Once engine's `enableGlobalVirtualStore`
flips, that install in any worktree made before the flip has to replace
a classic `node_modules`, and without a TTY pnpm aborts
(`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, reproduced on a dunes
clone). It now passes `--config.confirmModulesPurge=false`.

It also announces itself in `store-users/` before it probes the store
prune lock, through worktree.mjs's `withStoreUse` (G10). While a
`make prune` runs, land stops with a receipt and says to run it again.
`test/land.test.ts` checks the exact install arguments, that the
announce was there during the install and gone after, and the stop
under a held lock.

The J206 review's two MUSTs are in: an install a stopped land owed is
remembered in the worktree's git dir and runs first next time (the rebase
had already moved HEAD), and land never purges through a node_modules that
is a link (it could point at the canonical checkout's).
