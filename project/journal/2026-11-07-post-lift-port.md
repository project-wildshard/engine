# Post-lift engine fixes

Port 42c8182da0 (fix(test): cook crash proof writes no core) in source
order. Keep the behavior and repoint the retained files and imports to
engine's lifted layout.

Port 1d9c456852 (fix(disk): sweep up after killed runs) in source order.
Keep the behavior and repoint the retained files and imports to engine's
lifted layout.

Port 77eadd5ac8 (fix(pine): restore economy and journal parity) in
source order. Keep the behavior and repoint the retained files and
imports to engine's lifted layout.

Port aa3388c7b2 (fix(riding): restore server taming and calls) in source
order. Keep the behavior and repoint the retained files and imports to
engine's lifted layout.

Port cb6b6f06f7 (test(riding): prove offer, breaking and call) in source
order. Keep the behavior and repoint the retained files and imports to
engine's lifted layout.

Port 40e08ff28d (fix: isolate Pine rewards by player) in source order.
Keep the behavior and repoint the retained files and imports to engine's
lifted layout.

Port e554c9de59 (fix: persist rewards by device identity) in source
order. Keep the behavior and repoint the retained files and imports to
engine's lifted layout.

Port d75b25e179 (fix: validate legacy rewards before welcome) in source
order. Keep the behavior and repoint the retained files and imports to
engine's lifted layout.

The lifted scripts project checks every new helper, so give the three
Pine browser proofs their actual page and worker contracts. Correct the
fixture scope declaration to match its existing string namespace API.
The Pine reward integration test uses a full pinned product: classify
it in Ring 2, with full-suite coverage intact. Regenerate the admission
revision after the retained shardfile runtime changes.

All 26 touched runtime files match the source after path rewriting,
ignoring one blank line and the lift's cross-side worker URL. Focused
checks pass: cook worker 23, cleanup 8, riding 4, reward/wire/network 29.
The source tree was read through committed objects only.

The built iPhone-profile browser passes Pine economy 9/9 and durable
reward crashes 7/7. The grid proof stops during boot on "Missing KTX
2.0 identifier" before its reward checks; this needs a rendering owner.
The unchanged 30 fps riding pilot falls in rounds four or five, while
OFFER and trust work and the page reports no errors. Preserve the
requested upstream runtime and record these optional proof limits.

The inherited commit wrapper ran the hooks against a detached view,
which engine's main-only hook correctly rejected. Commit named paths
under the real checkout's lock and let Git run the installed hooks.
Keep foreign stages intact and add new paths with intent-to-add. Two
fixture checks prove selected-path isolation and hook rejection without
moving HEAD. The wrapper adds no bypass or alternate hook dispatcher.

Keep those two commit-entry checks as outer-edge integration tests.
They run the actual shell entry and installed hooks in disposable main
repositories, and pass in 1.13 seconds. The existing pre-commit suite
also passes all 18 checks; full typecheck and lint pass afterward.

The first full push gate passed 1,085 files and 5,574 tests, but caught
the wrapper simplification dropping candidate-patch source generation.
Restore that behavior and preserve loose outputs and peer stages. Run
the real installed hooks against the candidate in the main checkout;
remove the detached view and alternate pre-commit dispatcher. Verify
unchanged hook files, named stages and working inputs under the lock.
The candidate-generation regression and both boundary checks now pass
together: three tests in 1.65 seconds. No hook is disabled or skipped.

Source main advanced with cross-browser reward transfer during the
first gate. Include that port too. Type its real Settings download and
upload proof; let the caller select an external scratch root and remove
only the proof's own generated download directory afterward. Its 27
focused save/reward/page tests, full typecheck and full lint pass.

The restored generator found stale lift entries: shard composition and
closure call gen-shards, which belongs to sharddev and is absent here.
Boot audio and transport tables come from pins and gen:inputs, not the
old publication source rows. Keep engine's source-only producers in the
registry. All eight remaining source tables match HEAD byte for byte.

Port 23a5c1072e (fix(saves): carry rewards across browsers) in source
order. Keep the behavior and repoint the retained files and imports to
engine's lifted layout.
