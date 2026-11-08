# Resume the entered page, not its loader

The real glreload page entry reproduced the lifecycle error: the
existing pause menu opened while app state was loading. finishStage
then entered play while that menu stayed open. RESUME closed it and
restored its captured loading state, pausing the fixed clock again.

Move the existing menu handoff after the actual server-entry await,
which follows app.setState. The menu captures play only after first-row
activation finishes, then restores play and the running clock. Three fresh Chromium and three WebKit recovery URL boots
pass that exact public menu operation. No rendering, Three.js,
layout or widget implementation changed.

Fresh real road entry and GRID return still do not reproduce the
reported Ember Forge Gameplay/saved-state board. Do not invent a
board cause or change its readiness predicate. Those functional
steps pass in both browsers, as do two real WebKit process-loss
and offered-GRID resumes at the exact saved Ember pose.

Full grid-entry is not claimed green yet. WebKit reports Context is
stopped, with no JS stack, during cold-return navigation; an ordinary
cache control also reports it. Chromium automatic recovery can reach
an error before its first frame. The proof now waits for a completed
world or the actual title offer and captures the error modal message.
Keep those diagnostics and the remaining row explicit in the live
plan and external report; no promise error is hidden.

SF21a intentionally permits unrecorded process loss to return to the
renderer-free title. The proof takes the real GRID offer there and
compares the real worker pose. It never fabricates recovery data.
Grid-only persistent proofs also release their unused outer browser,
so each run consumes one actual browser instead of two.

The intermediate app-state-only move corrected RESUME, but actual Chromium recovery still stalled at server for 61 seconds. The final ordering waits for that server-entry port before parking. No precompile, shader, render-loop or UI implementation is edited. Three fresh successful recovery-menu runs per browser verify the final handoff; full process-loss checks remain separately reported.

Final runtime result: three fresh Chromium road/GRID/process-kill recoveries pass in full, with automatic resume and closed Ember board. The largest saved-pose difference is 0.0000553123 metres. The previous server61-second stall is gone on the final ordering. WebKit also restores the pose, but still reports the native Context is stopped at grid-tap with an empty JS stack. Ordinary-cache and delayed-title-tap controls do not remove it. A nonpersistent WebKit control without native promise observers completes three returns cleanly; the persistent-context source remains unidentified. Keep the full WebKit gate open, with no error filter or rendering/UI edit. Final source typecheck, lint and normal commit checks pass.
