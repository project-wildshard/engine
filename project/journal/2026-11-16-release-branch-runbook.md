# Release branches replace landing holds

> Written by: Codex
> State: current, 2026-11-16, RELEASE-BRANCHES RB9.

v0.1.25 proved the branch flow on live staging and production while
main kept advancing. Its tag is now merged into main. The runbook and
changelog header describe the actual helper phases, branch-owned
notes, exact branch CI, production proofs, cook and merge-back.

Daily plus on-demand releases replace fixed slots (J360/J362).
Ordinary main CI leaves staging alone; its channel follows an exact
green release head. Production follows the tested version tag.
