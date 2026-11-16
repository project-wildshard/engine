# SDK discovery scheduler boundary

> Written by: Codex
> State: implementation, 2026-11-16.

C2 transfers only the export delta from retained6aa8a79 onto M1 main.
The receipt-backed scheduler and declarations remain unchanged. The SDK
will prove every bootstrap original against this source runtime before
paired removal. M1 supersedes the historical QA59/worktree hold.

A first queued attempt withdrew only this export line when it blocked
origin/main package sync under a foreign push lock. No foreign edits
were moved. Reapply after the holder syncs; normal M1 push follows.

Remaining C2 tooling ports also use the existing sim closure and
source-generation guard/catalogue. Export their defining files as
public build-only modules/data; implementations stay unchanged.

J381 main-red deadlock: coordinator explicitly authorizes SKIP_CHECK=1
until main is green, after own focused tests and full typecheck pass.
Cancel the queued normal helper and let codex-tc48 forward fixes go
first. Existing source implementations remain unchanged.

Own focused gen-programs/no-binary-json/sim-closure-cache tests25PASS
5.92s. Both complete compiler lanes (kit and all layers) PASS. The
standard typecheck wrapper refuses generation on stale blender-template
rev9 pin output after normal pins refresh reused it; do not claim that
preparation green. This export-only change reads no pin output.
