# Refresh the pin manifest before land stamps assets

Rebasing across a validator change can invalidate the full pin manifest
while the pinned revisions and ledger stay current. Land stopped before
stamping in this state, including after a completed full gate lost a
race to main.

Use the existing pin installation once in each preflight, then check
the manifest and mounted bytes before running the generator. The
real-Git controls cover a validator rebase, a refresh that leaves the
manifest stale, and the refusals for missing or changed asset inputs.

The full gate also caught a declaration test that counted the new
`PROGRESS_WRITE_MS` export as a boot trace page alias. Check exported
variable bindings that reference `page`, including indirect property
reads. The test still checks the 18 named aliases in order and verifies
that those bindings read their matching properties once each.
