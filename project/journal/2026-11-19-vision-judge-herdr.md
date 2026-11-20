# The staging vision judge leaves claude -p (J474)

buddy-engine, 2026-11-19, a Coordinator unit. Rides v0.1.54.

Jake: "Claude -p is bad we need to stop" (meta AGENTS.md, J474). The staging smoke's SM3 vision judge was the engine's one
`claude -p` site: one call per scenario, up to 5 a release (12 on a deploy).

Now each judge is an interactive Claude in a herdr pane (`askJudge` in `scripts/staging-smoke/vision.mjs`):

1. a pane split down off the caller's pane, `--no-focus`, with `--env CC_SOUND_VOL=0` so it never chimes on Jake's Mac;
2. `herdr agent start judge-<hex> --kind claude` there, Opus with only Read and Write, no MCP servers, no slash commands;
3. `herdr agent prompt … --wait`: the old prompt, whose last line now says to write the JSON to a file;
4. that file is copied beside the sheet in the run's `tmp/<lane>` and parsed as before (same verdict shape);
5. the pane is closed.

With no herdr (`HERDR_ENV` unset, as in CI) the verdict is `skipped` and nothing starts. `visionPass` is now async, and
`deployVision` runs 2 judges at once, not 4: each is a pane split off the caller's, and four make them unreadable.

One change from the brief. The judge does not write straight into the run's folder. My first live run passed that folder
with `--add-dir`, and interactive Claude stopped at its trust question: the folder is inside the engine repo, and saying
yes trusts the whole repo, its skills and hooks included. (`-p` never asks.) So each judge works in a folder of its own,
`~/.cache/wildshard/plan-artifacts/vision-judge/<name>/`. That is outside every repo and under the cwd the old call used,
which is already trusted. The folder holds a copy of the sheet and the judge's verdict; the verdict is copied into the
run and the folder removed.

Live proof: one judge on a Bag before/after sheet answered `changed` in 13 s, quoting the bullet. Its verdict landed in
`tmp/buddy-engine/j474-proof/K3/`; no pane or folder was left.

Tests (`test/staging-smoke-vision.test.ts`):

- a stub `herdr` replaces the stub `claude`, and a stub `claude` that fails is left on PATH, so any call is caught;
- the pane split, the judge start and the close are checked;
- no herdr gives `skipped` from both passes;
- a scan of scripts/, src/, .githooks/ and .agents/ finds no claude call with `-p` or `--print`. Comments are skipped,
  since a few name the old reviews.

The mini takes repo-kit's sites (one-shot-review.sh, lane-host-check.sh).
