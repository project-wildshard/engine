# FP59: a reused pins install skips a source with stale receipts

On engine main a reused `pins.ts install` cloned another worktree's products, and the preparation client build then
refused one: "Stale output validation receipt: brasscap-mesa". The reuse key matched; the receipt did not. Reuse now runs
the build's own receipt check (validator revision, index hash, source hash) on a source before cloning from it, and
skips the source, so the full install runs, when any product would fail.
