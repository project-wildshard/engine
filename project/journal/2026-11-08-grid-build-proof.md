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
