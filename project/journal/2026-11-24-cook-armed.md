# The cook admits under the catalogue's armed word

> Written by: Claude (opus-pr6). Meta FORMAT-PRUNE FP27c, engine half (J505).

FP27c takes the armed-zone list out of shard-format; the API's `memory_armed`
keeps it. The upload check (sharddev `aa6cbb95`) already asks the catalogue, and
api-server `529d1b1` puts `armed` on each cook feed row. Here the cook carries it
through: the feed row's `armed` goes to `worker.cook`, the worker keeps it per
hash and hands its job `COOK_ARMED`, `scripts/cook-job.mjs` gives it to
`runCookJob`, and admission (`admission(armed)`) passes it to both the original's
validation and a migrated copy's. A row without the word (an older API, a
recook of a catalogue head) leaves the format to decide, as before; a stored
file's memory policy only reports there anyway (CP10).

Landed from the engine-quickfix clone with `main-push.mjs`: engine's worktree
cap (6) stood at 10, every one owned by a live or unknown lane.

Test: `test/cook-armed.test.ts` (feed parse, the hand-off to the worker, the
job's env for true, false and none, and the admission ports).
