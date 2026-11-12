# Plans

Live plans for this repo, one file each: `<model>-<YYYY-MM-DD>-<slug>.md`
(the `write-plan` skill). Each opens with a State line that leads with
its state, e.g. `> **State:** ready for review, 2026-11-07.` States:
draft · ready for review · draft, parked · in progress · held · done.
`.githooks/pre-commit` checks new plans and refuses the old `Status:`
line. Done plans move to `project/archive/`.

Cross-repo plans for Project Wildshard live in
`Raynos/project-wildshard-meta` under `docs/multi-repo/`.
