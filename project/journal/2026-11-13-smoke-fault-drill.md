# The Template 2 smoke's fault drill (opus-te2e2)

> Written by: Claude (opus-te2e2), 2026-11-13

TEMPLATE-E2E T2E-2 asks that each step of the smoke go red on its own planted fault. `scripts/e2e-faults.mjs` (`pnpm
test:e2e:faults`) plants one fault in the real source, runs the smoke's `template-2` project with the JSON reporter, puts
the bytes back, and checks that the first red `test.step` is the one the fault aims at.

- **Faults today:** `use-unbound` (E bound to nothing in play) and `door-hook-stubbed` (the interaction's scene,
  `blender.door.toggle`, runs nothing) turn step 3 red; `save-skips-door` (the script world's checkpoint keeps the door's
  shared field, `blender.door.open` id 101, at its default) turns step 7 red. Steps 4 and 5 (bag key unbound, attack dropped)
  wait for Template 2 to carry a pickup and a weapon (shard-format S2-1, S2-2, a published `@wildshard/format` release).
- **Dropping the quest flag alone stays green.** The first cut of the save fault left `blender.door` out of the sim
  snapshot's flags, and the smoke passed: the quest earns the flag again from the door's field as the world restores. The
  door's real state is the field, so that is where the fault goes.
- **Every drill builds cold, and checks what it served.** Each plant carries a marker string that survives the bundle
  (`e2e-fault-<id>`), and the drill refuses to judge a run unless the served client holds that marker and no other. The
  first drills ran on the warm watcher and two of them lied: the door-hook stub went "red" on the previous fault's build,
  then "green" on a build without the stub. The watcher's `fs.watch` missed a write and its restore made seconds apart (no
  `changed` line in `tmp/e2e/watcher.log` for either), so its ready answered with an old generation. The drill now stops
  the watcher before each plant and after each restore, about 25 s a fault. The same miss could serve a stale client to a
  normal smoke run after a quick edit-and-revert; not chased here.
- **Stopping it never leaves a plant.** A `claude -p` review found the SIGINT handler dead: `spawnSync` blocks the
  event loop, and Ctrl-C reached only the child, so the drill skipped to the next fault. It now stops when its child dies
  on a signal, and writes `tmp/e2e/faults-planted.json` before each plant, so a killed drill is put right by the next
  one; the restore happens only while the file still holds the plant (an edit made meanwhile is kept and named).
