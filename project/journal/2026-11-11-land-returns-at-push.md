# Land returns at the main push and cleans up after itself (LAND-SIMPLIFY LS5)

J258: "Land returns as soon as main is pushed", with a watcher reporting
main's ci. `scripts/main-watch.mjs` landed first (`643eeaf0`), and land
already starts it after landing, so land's own wait can go.

- A carried land no longer waits about 10 min for main's own run. The
  receipt says `main ci followed by main-watch`; `--watch-main` brings
  the old wait back (exit 3 on red).
- Main races: at most 5 tries (`--rounds` default 6 -> 5, Jake: "5
  tries"), then land stops and says so.
- Cleanup (Jake: "Yes, land cleans up its own"): after landing, land
  deletes `origin plan/<slug>` under a lease on the SHA it pushed. From the
  canonical checkout it then removes the worktree (`git worktree remove`,
  never forced) and its local branch. A worktree with uncommitted or
  untracked files is kept and named. `--keep` skips all of it. The land
  lock is released first, since it lives in the worktree's git dir. The
  reaper stays for abandoned worktrees.

J206 review: cleanup runs under the land lock and checks that HEAD is
still the landed SHA on the plan branch; main-watch starts from the
canonical checkout's copy (or a private one), never from the worktree
about to be removed.
