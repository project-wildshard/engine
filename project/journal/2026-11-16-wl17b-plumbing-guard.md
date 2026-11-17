# Refuse raw commit plumbing explicitly

> Written by: Codex
> State: locally qualified, 2026-11-16; WL17 hosted qualification remains open.

Nine real guard controls failed first. Global Git options, command
prefixes, external index assignments and the valid merge exception
could bypass the old accidental commit-prefix refusal. The merge
control creates an actual pending merge, admits its ordinary commit,
and proves raw commit-tree was incorrectly admitted there.

Add explicit refusal before the existing merge exception. Preserve
quoted argument boundaries without interpreting their contents;
recognize ordinary Git global options, command/env prefixes and
external GIT_INDEX_FILE assignments. The sanctioned commit.sh patch
entry, normal pathspec commits and real merge commits remain valid.
Read-only grep/status and quoted illustrative text remain admitted.
Both recorded agent payloads exercise every new control. The same
source/tests are carried in repo-kit. No hook bypass or new Git
transaction. Current full hooks/shellcheck and engine types/lint/CSS
pass; selected commit-entry4/4 passes. Final positive controls join
the ordinary pre-commit and hosted gates before parent completion.
