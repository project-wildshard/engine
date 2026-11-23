# Boot stamps are ignored build outputs (SHARD-COMPAT LS1, LS9)

The three boot stamps gen:inputs writes from the installed pins went stale in every
checkout whose pins differed from the last land, so a fresh clone or worktree showed
10k lines of diff after gen:inputs, and land had to commit them before each push. They
are ignored now; prepare, vitest, lint-game and typecheck write them when missing, and
npm-publish writes them from the pins before packing.
