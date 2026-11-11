# The Template 2 smoke runs the game

`pnpm test:e2e` used to load the `engine serve` status page and nothing
else. It now also plays Template 2 on one headless page: the real title,
Shard Select and Enter, a walk with a jump, E on the door, the walk to
the guardian's region that completes the quest, then a hide (the page's
save), a reload and the same title again, where the door is still open
and the quest still done. A console error or any request off the machine
fails it. The draft cards' blob thumbnails are the one exception, and get
an empty image. The pickup and the fight wait for Template 2 content in
shardfile (S2-1, S2-2).

The client is option C from TB-1, a warm Rolldown watcher per worktree
(`scripts/e2e-watcher.mjs`). It runs under a heavy-lane build lease, goes
through build-app's own prepare and finish, and serves the result with
the preview server. A run asks it over loopback HTTP for a settled
build. On this Mac, five one-line edits to `src/client/app/entry.ts`
each had a client again in 11.4 to 12.1 s, and the whole smoke took
about 23 s. A cold start took 34 s. Most of the 12 s is the finish
copying and cutting parts for every product the worktree holds: with
Template 2 alone it is 4.3 s.

Two dead ends on the way. A symlinked build root holding only Template 2
breaks Vite, which names modules by their real paths, so the chunk rules
and the doctor page's HTML input no longer match. Installing Template 2
with `--from-format` used to strip the other pins' public assets, which
then rewrote three tracked boot tables. That install now adds Template 2
beside the others.

Under `sandbox-exec` with outbound networking denied, a cold run passed
in 31 s: Template 2 was installed from the dependency and `pins.ts
status` named it as the source. `bash scripts/e2e-offline.sh` repeats that.
