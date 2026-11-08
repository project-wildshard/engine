# Prove the entered grid on the pushed build

Jake reported that MEMBAR and LS6 had seen a home-loading stall on a
local engine preview. The LS-UI preview inspected here identified itself
as 9673561-mw7a0426, built at 03:31:51 UTC. It contains only _template,
blender-template and sunscar-dunes under shardfiles; Driftwood is absent.
That artifact cannot establish whether the real grid home loads.

The full-catalogue candidate contains all 28 pinned products. Its real
title GRID tap, normal Enter control and first 30 worker-backed frames
passed on Chromium and WebKit. Both played driftwood-isle with a null
home loading board and an open server. Loader completion was 22156/5280
ms; maximum unnamed gaps were 285 ms in both. No readiness or completion
event was injected. This is candidate evidence, not yet a pushed verdict.

The manual proof now checks the entered home and board, and accepts
--expect-build=<full SHA>. That requires clean source at the exact SHA
and matching served build metadata. Run that after the loading batch is
pushed and rebuilt, before judging the reported preview stall. The new
check stays outside hooks and the unit-test glob. Types and lint pass.

Ordered integration now follows published SR batch 8278424, whose whole
normal pre-push passed in 821.9 seconds. The rebased helper's inline
callback JSDoc imports failed source type resolution; module-level type
aliases fix that without changing browser behavior. Full typecheck and
53 focused PWA/title cases pass. The normal 28-product build passes.

The rebased candidate grid passes again on Chromium and WebKit: first
step 2448/2640 ms, loader-complete 22888/4947 ms, maximum unnamed gap
284/283 ms. Both enter Driftwood, clear the home board and retain an
open server with at least 30 frames. Each title-page stress retains all
5,000 actual worker receipts in two entries, without overflow.

A separate actual server cache miss with five seconds of delayed server
work passes in both browsers. Loader-complete is 13207/8451 ms and the
largest unnamed gap is 281/269 ms. Worker streamed bytes are observed.
No browser remains open. The normal full LS1 publication gate is next;
the final pushed-build verdict still waits for that exact-source build.

Publication completed at a84f050d30f8d3dfc04a097bb445494c689e9e0d.
The full normal pre-push passed in 859.5 seconds. The remote main was
verified before the final proof. Clean source and served metadata both
named a84f050-mw7crm6l, saveEpoch 1, with the full 28-product catalogue.

That pushed build passed real GRID/Enter boots in Chromium and WebKit.
Both entered Driftwood, closed the home loading board and retained an
open server at 30 frames. Loader completion was 23439/4745 ms; maximum
unnamed gaps were 284/286 ms. Each retained 5,000 real worker receipts
in two entries. The reported limited-preview stall did not reproduce
on this exact pushed build. This does not close the distinct S1 return
or actual process-loss recovery findings.
