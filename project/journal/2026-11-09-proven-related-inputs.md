# Related selection needs a real edge for every input

Old pre-push selection treats any path not matched by its harness regex as an
import-graph module. A real Git change to a SQL migration is classified related,
instead of full, reproduced in 0.064 seconds. Budgets, lint JSON, Vite helpers,
workspace/package-manager settings and executable-tool inputs have the same gap.
Vitest related itself exits zero when it discovers no tests.

The classifier now allows related mode only for source or test JS/TS modules
outside the existing harness/fixture exclusions. Unknown paths and non-module
extensions use the full gate. Documentation optimization requires actual
Markdown paths; arbitrary JSON or code under docs is no longer silently skipped.

Under the real lease, before execution, each changed module must independently
produce at least one actual Vitest test specification. This uses the public
Vitest dependency-discovery API, with no time cap or trimmed test list. A missing
or deleted module, empty graph, mixed covered/uncovered change or graph failure
uses the complete suite. Related execution also explicitly refuses no-tests
success. Its final proved scope, including a full fallback, is what gets cached.

The push profile cannot defer missing-product suites through the ordinary local
author/commit shortcut. It keeps strict product preflight like CI. The ordinary
author shortcut remains outside the authenticated push gate.

The outside-hook CLI creates real Git commits for seven invisible input classes,
proves actual empty-related success with Vitest, and exercises real discovery
for covered, uncovered and mixed module changes. The old SQL classification is
red; all conservative new selections pass without reducing any original test,
compiler, lint, isolation, case or runner budget.
