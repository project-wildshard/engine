# Keep two native identities across a release

> Written by: Codex
> State: built locally, 2026-11-16; E7.2c.b.2, hosted proof owed.

The generic staging bot never reconnects. A separate bounded observer
keeps two private identities, waits for genuine native movement, observes
a signed serial/build change and redials only after the old link closes.
It never disconnects clients to manufacture a rollout. No serial change
is inconclusive. Connection evidence alone leaves durable continuity and
failed saves unknown until the checkpoint/report rows qualify them.

Compile the native client from the authenticated baseline's exact Git
source using the ordinary frozen offline install/build-server helper.
Source/build/archive cleanup is owned; cancellation kills the owned
process group and removes only its exact store-use marker. The staging
CLI has one deadline, four-seat human headroom, private random identities,
symlink-contained scratch, no production/restart/publish options.

Four actual native World controls and four process/CLI controls pass;
all35 input/route/native/process controls pass together. The real source
preparation path also built staging94 f8ff9bd9, verified its stamp and
removed its extracted tree/build. That control was read-only, no live
native join. Full normal lint/types pass. No escape hatch used. Ordinary
staging promotion and phone acceptance remain final MS9.
