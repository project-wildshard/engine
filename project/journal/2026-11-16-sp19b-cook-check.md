# Full check in the cook child

> Written by: Codex
> State: local source qualification, 2026-11-16; hosted proof follows the SP19/SP20 land.

SDK-SPLIT SP19b replaces the proof-only cook port with the shared full check.
Native execution remains explicitly unmeasured; the performance card and entry
failures stay intact. A failed infrastructure call is retryable, while a completed
refusal is a verdict on those bytes.

The child writes its complete result beside its output, inside its sandbox.
Diagnostic stdout remains bounded without truncating the report. The parent
retains the shared report in its row and durable cook index. Legacy indexes
without a full check are recooked before approving any new upload. Invalid JSON
from a crashed child becomes a retryable failure.

Local: 33 cases across shared full check, worker, limits and publishing pass.
Controls compare author/cook budget and entry refusals unchanged, retain a
2.4 MB refusal beyond the diagnostic cap, exercise actual cooking and sandbox
limits, and recover the complete report from the cook index. Six-shard and
SDK consumer qualification are still owed; this journal does not claim hosted
qualification or deployment.

The first hosted run exposed the GC test's stand-in report omitting the new
mandatory check. Its fixture now supplies an explicitly fake successful report,
and asserts the first cook succeeds before testing reuse and collection. The
worker's admission remains mandatory; the failed run was canceled before retry.
