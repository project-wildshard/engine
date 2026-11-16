# TC8: isolate the current hover failures

> Written by: Codex
> **State:** diagnostic implementation, 2026-11-16. Held plan/tc8-crater.

Current-main nightly 43813104202 at 028d1bec boots, draws and explores all
six Chromium group-3 products, but every hover observation times
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

The first standalone diagnostic workflow could not dispatch before its
file reached the default branch (actual GitHub 404). The diagnostic now
uses optional inputs and a mutually exclusive job on the existing
nightly workflow, so it is reviewable and runnable from a plan branch.
Diagnostic runs skip suites, the full matrix, report and Ring 3.

The real full-night suite-0 receipt also exposed a producer defect:
workflow run ID 43813104202 was passed directly as NET_FUZZ_SEEDS,
outside the unchanged uint32 admission boundary. The real hostile-play
file reproduces that collection failure with zero assertions; mapping
the decimal ID to its low 32 bits makes both actual pinned-world cases
pass in 1.38 seconds. Only the workflow seed producer changes. The full
run ID remains the receipt identity, and the bounded seed is replayable.

Hosted diagnostic 43821122745 at c9c37a94 isolates the actual failure:
mount succeeds with a visible owned board, then the second tap leaves
the player mounted. Production Developer mode interprets taps within
BOOST_TAP_MS (300 ms) as boost; the existing pointer-input tests require
that behavior. The nightly now spaces its two intended single taps
beyond that exported gesture window. It still requires an actual mount,
a visible owned model and actual unmount, with unchanged deadlines.
Failure facts also include the real boost latch.
