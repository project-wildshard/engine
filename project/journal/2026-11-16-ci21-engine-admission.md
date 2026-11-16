# Admit restored engine tests to the language gates

> Written by: Codex
> **State:** prepared, 2026-11-16. Parent exact land and C1 hosted proof
> pending; J206 clear.

C1 had55 blocking runtime files, but17 root tests were absent from
every compiler project and18 were explicitly ignored by lint. Keep
all existing cases and frozen inputs while restoring their real gates.

Remove those compiler/lint exclusions. Normal lint-game now selects
all54 root tests in complete, selected and fallback runs; the graph
shadow-offset test already belongs to its source tree. The declared
list equals the complete C1 root cohort. Extend the existing manual
real-Oxlint proof: a broken restored root test must fail selected,
complete and fallback lint; repaired source must pass. Refuse missing
or ignored entries through actual CLI eligibility before checking. These new controls stay
outside hooks (J186).

Pine's frozen range JSON infers number[] for a real six-number box.
Check its length and finite values against PosedAssetRange['box'];
keep the fixture bytes and every original assertion. There are no
casts, replacement ambient contracts or rewritten test expectations.
The old subset-lint probe diagnostics disappear under proper compiler
admission; no property/Node-fs workaround was needed.

Actual full pnpm typecheck and normal pnpm lint pass. The whole55-file
C1 group passes329 cases in28.13s; real selection controls pass1.49s.
Actual compiler membership and CLI file discovery cover all55, with
zero remaining cohort ignores. Full experimental lint:typed still
reports974 out-of-cohort diagnostics on the current graph;
zero concern C1 files or the changed driver/proof. Its old7e baseline
had952. This does not describe that command as green.

Worktree reused on local plan/ci21engine-c1 while parent611's exact
remote CI continues read-only. Stop the land waiter before changing
branches. Preserve plan/ci21nalati-build611 and land it normally under
J384 before C1 lands. No extra worktree, main push or row tick.
Read-only J206 found no MUSTs. Both initial SHOULDs and its final
selected-missing proof suggestion are fixed. No assertion or budget
was weakened; full source/fixture data remains unchanged.

J381: ALLOW_BRANCH=1 for this commit. The coordinator explicitly
approved reusing ci21nalati-build for plan/ci21engine-c1 under the full
worktree cap; the folder-name guard still demands the old branch.
Normal compiler/lint/format checks remain. Report the guard mismatch
in mini QA; no extra tree or main push.
