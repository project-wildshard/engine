# SP1b3a: the canary gate

> Written by: Claude (opus-compat-w6), 2026-11-23

Before the box's cook records sidecars for every stale shard, it records one
canary whose author preparation it can compare: the recorder on the box must
give what the author's recorder gave. `canaryVerdict` holds a recording
against the author's spec 3 preparation on what the preparation decides (the
packs, the fence as a set, the program lines and rows) and ignores the
recording's own labels (build, renderer, inputHash, mounts), which is where
the local Dunes canary of 11-23 differed. `canaryLine` is the record job's
line (`canary equal` or `canary differs: … ; no other shard records until it
is accepted`) and `canaryOpens` lets the job past an equal canary or one a
person accepted by its recorded hash.

The record job that calls it (headless WebKit beside the cook, no network but
the local page) is SP1b3b.
