# A full worktree cap lists ended worktrees; nothing removes them (J358)

> Written by: Claude (opus-pr6). Coordinator order 11-24: J358 wins over Build-max C4's cap reaper (`738764b36`).

`738764b36` made `worktree new` reap the oldest landed, clean worktree idle 30 min at a full cap, after a keep-copy. J358
(Jake, 2026-11-15: *"No fucking auto delete in scripts Claude's can audit and delete what makes sense"*) allows only
`land` to remove a worktree, its own just-landed one. Now a full cap refuses and lists each ended worktree (landed, clean,
idle 30 min, no process or pidfile inside, owner file or not), oldest first, with its copy-first removal command:

    node scripts/keep-copy.mjs .worktrees/<slug> && git worktree remove .worktrees/<slug> && git branch -d plan/<slug>

The cap (10, `b36bc05fc`) and origin/main's tool copy (`954f1ea44`) stay. repo-kit `9e29481` and sharddev do the same.
Test: `test/tooling/worktree.test.mjs` (the list names exactly the ended ones; every worktree and branch stays).
