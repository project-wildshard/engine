# Require the pin publication ledger

Engine CI run 45956641997 caught a regression in the DS22 boot input
check. QA29 let a matching pin manifest return a verified key when the
publication ledger was missing. The boot check then diagnosed a missing
mount and skipped its missing-publication path.

The verifier now requires a readable ledger with a `published` array
before returning the key. An empty array still proves an install that
published no mounts. The push-proof fixture covers both cases alongside
the worktree land test.
