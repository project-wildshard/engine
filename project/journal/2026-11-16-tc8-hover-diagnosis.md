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

All eight completed full-night head receipts also expose a hard WebKit
producer bug: the shared boot frame requests Chromium-only CDP on WebKit.
WebKit now uses its public Playwright viewport PNG API within the same
original capture deadline. Font/compositor readiness, actual PNG pixel
analysis, black-frame refusal and ordinary Chromium capture remain.
Hosted single-head runs verify the actual browser boundary.

The full night's Template 404 is the old whole-level manifest, not the
new cook's asset. Detaching only the inline entry row left `_template`
in the packs book, whose exact lookup precedes the new `template` row.
The diagnostic now detaches both entry and whole rows (and optional
program inventory) before the production installer attaches the cold
product. Each head starts from the original book, restored on cleanup.
The production installer's rule to keep a build's own product is unchanged.

Pine's cold cook exceeds 600 seconds in both browsers. Ring 2's launcher
also used a private 2 GiB heap / 4 GiB resident cap, below production's
4 GiB / 6 GiB. Ring 2 now reads DEFAULT_LIMITS for all three limits and
prints them. Its 600-second deadline stays; Ring 1's smaller envelope
stays. This corrects the qualification envelope; it does not establish
the cause of Pine's timeout. A targeted hosted run will check the cook
under production limits.

The old runner deleted every boot/Explorer failure receipt, retaining
only a truncated phase error. Their common directory also allowed an
Explorer success to overwrite the boot JSON. Each observer now gets its
own subdirectory; failed heads retain their actual JSON observations in
the uploaded artifact before large packs/captures are retired. Successful
heads keep the existing compact receipt. No screenshot or trace archive
is added to the artifact, and admission does not change.

Template diagnostic43823462430 now passes cold cook, actual boot, draw
and Explorer: the old manifest404 is healed. Its next hover failure
exposes an early tap while EquipmentService.enabled is false; it becomes
true before the failure receipt. Live gameplay frames can precede the
async equipment entry owner. The hover journey now waits at most10s for
the actual owned/enabled board and allowed input before tapping. The
mount/model/unmount checks keep their10s deadlines; no state is assigned.
