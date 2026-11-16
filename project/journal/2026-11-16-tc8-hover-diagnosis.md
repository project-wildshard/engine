# TC8: isolate the current hover failures

> Written by: Codex
> **State:** diagnostic implementation, 2026-11-16. Held plan/tc8-crater.

Current-main nightly 43813104202 at 028d1bec boots, draws and explores all
six Chromium group-3 products, but every hover mount observation times
out. A separate actual NetClient/NetRoom run mounts and unmounts all six
current full pins with replicated board bits and zero drops. Native
motion authority works; the page's input/equipment/view state is missing
from the failure receipt.

The hover phase now reports its real before/after state on failure while
keeping both actual tap/ownership/model assertions and their deadlines.
A manual-only single-head workflow invokes the existing production
nightly runner with one committed pin and browser. It reuses ordinary
partitioning and encodes, cold-cooks on the hosted runner, and retains
raw receipts. It runs no report, Ring 3 sender or release qualification.
Default push/nightly work does not grow. The selector's two explicit
proofs cover actual committed pins and admission refusal.

The six native observations and hosted receipts live in meta under
TEST-COVERAGE evidence/tc8-028d1bec. No local browser or cook ran.
