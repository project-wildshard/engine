# keep-copy saves the small part of a tree over 50 MiB (opus-keep, meta QA 11-25 row 34)

- keep-copy refused the ended qa-play worktree as over 50 MiB and wrote nothing; it was then removed by hand and
  QA 11-24 row 7's `tmp/opus-qa-play/local-update.mjs` went with its big stg-* profiles. Over the cap keep-copy now
  still writes the unpushed commits (the existing bundle), the patches and every source or script file up to 1 MiB
  (smallest first, up to the cap), skipping captures, big files and nested node_modules or dist; SKIPPED.txt lists
  the rest. Then it throws PartialKeepCopy naming the copy (CLI exit 2, the path on stdout), so `keep-copy && git
  worktree remove` and land's cleanup still keep the tree, and land's line says where the copy went.
- A bundle, not a pushed keep ref: it needs no network, no push gate and leaves no ref on the remote to clean up.
- worktreeState over the cap stats instead of reading gigabytes: such a snapshot never clears a removal.
