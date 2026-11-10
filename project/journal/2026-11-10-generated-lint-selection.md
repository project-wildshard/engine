# Preserve the lint gate for generated-only commits

Port's real generated-table commit fails because the staged paths all
match the existing lint ignore rule. Actual pnpm lint bytes.generated.ts
versions.generated.ts reproduces No files found to lint and exit1. The
full declared lint is green, so this is a selection error rather than a
source error. The selectors must preserve their declared gate.

When an explicit Oxlint selection reports no files, lint-game now runs
its complete original tree and uses that actual result. It preserves
all flags, native-tool pin/environment, thread budget and source rules.
Whole-tree and mixed-source calls keep their actual lint behavior.

The real project command is green after the forward. A tiny owned Git
root invokes actual Oxlint through the current declared resolver: clean
generated-only fallback passes, an unselected real source debugger is
caught by that fallback, mixed bad source fails and clean direct source
passes. Four outcomes in0.49s, no fake executable or gate bypass. This
manual proof stays outside automatic hook/test discovery.

Port's actual normal commit then exposes the second boundary: the full
fallback passes every check but takes12.8–14.7s against the unchanged
8s cap. A lawful one-thread benchmark is slower22.8s. No budget changes
or repeated blind commit retries solve that unnecessary scope expansion.

The commit lane is defined to lint staged code, format staged code and
typecheck the complete project. Every job still runs. After actual
Oxlint confirms zero inputs, existing regular generated files use its
supported no-error-on-unmatched-pattern mode over the SAME declared
staged selection. The current ignore rules already exclude these files;
no ignore rule is added or changed. Unknown/missing/non-generated empty
selections retain the complete-tree fallback, and mixed active source
retains normal errors. Complete typechecking, formatting, pre-push/CI
full lint and all budgets are unchanged. The real five-outcome CLI proof
passes0.77s, including nonexistent generated-looking input refusal.
