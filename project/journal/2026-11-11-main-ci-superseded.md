# Main CI runs stop cancelling each other

opus-rescue's land reported MAIN RED on `6363b3f3`; the run was only
cancelled. spawnparts pushed `652afa6c` a minute later. ci.yml already
had cancel-in-progress false on main, but GitHub keeps one pending run
per concurrency group and cancels the older pending one anyway, so with
lands a minute apart main never confirmed anything (J249 relies on it).

- ci.yml: a push to main gets its own group per SHA, so every main run
  finishes. Plan branches keep one group and still cancel older pushes.
  Main runs are mostly the exact-reuse check, so this costs little.
- land: a main run that is only cancelled while a newer main commit
  contains the landed one is "superseded by <sha>"; land watches that
  run and reports red only if it is red. A cancel with nothing newer on
  main stays red.

Tests in `test/land.test.ts`: the evaluated concurrency keys, a
superseded run going green, and a lone cancel staying red.
