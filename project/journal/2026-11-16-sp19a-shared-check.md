# One report for author check and the cook

> Written by: Codex

> **State:** local SP19a source; cook/SDK composition and hosted qualification remain open, 2026-11-16.

The existing validateSimulation already combines observation and the
complete entry walk in one native resident. The full-check entry point
uses it once, then applies format's defining performance report. Both
callers receive one serializable report with proof counts, the complete
performance card and untruncated failures. A failed execution never
becomes an empty successful proof. Zero-lane evidence stays unmeasured.

J370's native rule stays explicit: no trusted recipes are invented, no
fake execution samples are supplied, and the existing author warning
policy reports native view/execution as unmeasured. The cook's data-only
path defaults to refusal; only trusted local checkout provenance may
request the existing warning policy. Author input selects neither port
nor policy through the CLI.

This module owns its binding and public export. The shared report
contract has no renderer or Node dependency. No draft SDK package split
or removal of build-time checks is included. SP19b composes the cook;
the SDK consumer and real hostile/cook qualification still remain before
SP19 can be ticked. The engine branch also owns SP20 and lands once after
both components are complete, under J384's exact fast-forward rule.
