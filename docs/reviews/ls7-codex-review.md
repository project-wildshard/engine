# LS7 Codex review: hold the two Opus commits

Status: GO for the reviewed LS7 lifecycle and measured-weight source.
Publication remains held by the separate saved-place consumer proof and
the required full normal gate.

Reviewed committed blobs only. Neither foreign clone's dirty generated
files was changed. The three preceding Codex commits are not rejected
by this review. All four strict bar proofs are useful timing evidence;
they do not exercise these failure paths.

## Native fence lifetime and earned units

The exact FencedUnits class from committed 907ae63 was transpiled for
a manual native-WebGL integration probe. It ran against the real game
renderer and an actual child Scope in the full-catalogue a84f050 page,
on iPhone-size Chromium and WebKit. Native GL calls were observed and
forwarded without replacing their results. This tests the committed
class and native boundary, not an entire 907ae63 application build.

Both browsers reproduced both reds:

| Native path | Observed result after 100 ms |
| --- | --- |
| Dispose the real owner after submitting one fence, then drain | Promise unsettled; one sync created, zero deleted, one still a live native sync; zero units completed |
| Lose the real context using WEBGL_lose_context, then submit/drain | Context genuinely lost; zero fences created, yet one unit credited as complete |

Game.ts FencedUnits.submit turns a lost context into a null fence, and
settle credits that unit after a frame. Loss is not completed GPU work.
The same method treats every clientWaitSync result except
TIMEOUT_EXPIRED as completion; WAIT_FAILED must not earn work. That
last branch is a static finding, not a separately observed native run.

The frame promise also has no cancellation settlement. Scope.raf and
Scope.timeout return without running callbacks once closed, so owner
disposal leaves the awaiting drain and its queued sync alive. No
finally/dispose path drains remaining handles when preparation or a
progress callback rejects either.

Required before GO: count only signalled fences; reject context loss
and wait failure without progress credit; explicitly settle owner
cancellation and release every queued native handle on all exits.
Repeat the native loss/disposal cases, including loss with a fence in
flight and a callback failure. These are rendering lifecycle changes
for the Opus owner; this review changed no rendering source.

## Measured weights

The comments identify a reproducible Sunscar phone-profile source for
renderer 0.14 s, shaders 0.59 s, firstFrame 6.67 s and Server world
1.86 s. The journal also identifies the browser, CPU/network profile,
command and date. This is useful provenance.

The newly active path-owned weights remain 1 with only a range of
about 0.4–1.8 seconds for several different rows. That is not each row's
measured seconds/source. Zero-formatted measurements are assigned a
0.01 floor rather than their raw measured values. Previously ignored
legacy weights also become active without a measurement here.

Required before GO under Jake's explicit rule: write each active row's
measured seconds and source, retaining raw precision or documented
measurement resolution. Keep unmeasured paths outside the calibrated
profile until measured. Do not obtain strict acceptance by raising a
share or a floor without its measurement. Re-run strict actual boots
after the fence fix and stronger independent oracle are in place.

## Codex re-review of 495aaac, f211ba7 and 6d19538

The committed replacement FencedUnits class passed six real-WebGL paths
in Chromium and WebKit using actual game child Scopes. This is the
committed class transpiled into the full-catalogue b330883 page, not a
claim that an earlier application build contained later changes. The
manual native proof is scripts/loading-fence-proof.mjs, outside hooks.

Normal completion created/deleted/credited 1/1/1. Disposal returned
disposed with 1/1/0. Loss before submit returned context-lost with
0/0/0; loss in flight returned context-lost with 2/2/0. Deleting an
actual native handle induced WAIT_FAILED, returning wait-failed and
1/1/0. A throwing callback released both queued handles; only its
already-signalled GPU unit earned internal credit and no callback
progress succeeded. Every case settled, with zero pending handles.
Game.firstFrame wraps all preparation and progress callbacks in its
units.dispose finally. Native lifecycle findings are closed.

f211ba7 records the measured seconds for every calibrated row, its raw
precision, build, browser, profile, command and date. Unmeasured paths
retain their previous equal completed-work shares. The initial 8.6778
modules weight included Start: re-review found that overlap, and
6d19538 replaces it with the measured 0.364-second Load-only span from
app:loading-adopt in the same timing source (also repeated at 2c12f2c).
Start retains its independent completed boundaries/code-byte bar; its
seconds no longer supply the modules share in Load. These source
findings are closed. The strengthened oracle must still pass the four
strict boots before publication; historical label-based greens alone
remain insufficient. Normal commit checks must cover the whole stack,
including 6d19538, which its author committed with SKIP_CHECK=1.

The stronger independent oracle subsequently passed all four installed
catalogue cases: Dunes Chromium/WebKit ready 22.0/3.3 s, _template
12.1/2.7 s, each with zero stalls, backwards, untraced changes or page
errors and actual native clipboard readback. An uncatalogued legacy
template fallback has separate real Chromium renderer stalls, recorded
in the producer-proof journal; it is not folded into these four greens.
The native probe now independently observes the native sync handles
and adds disposal before drain: seven paths per browser, all green.
The coupled fake-GL unit file is replaced by this real browser proof
under J186; it was green before replacement. No new hook is added.
