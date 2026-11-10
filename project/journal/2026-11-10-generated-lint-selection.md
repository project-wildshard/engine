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
