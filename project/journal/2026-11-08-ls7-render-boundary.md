# LS7: keep the real renderer boundary visible

Written by: Codex. 2026-11-08. Meta LOADING-SCREEN-PLAN LS7.

Record the existing shader and first-frame callback counts in Copy
diagnostics, including the completion after the awaited first frame.
This changes neither Three.js nor shaders nor render ordering. The proof
also records Start body and Server work counts and refuses absent counts.
Only Chromium gets CDP 4x CPU/network throttling; WebKit's tag now says
WebKit rather than claiming a throttle it does not receive.

Baseline strict Dunes: 5.0 s stall, no backwards or untraced changes.
With Start/Server counts: Chromium 19.7 s ready, one 4.9 s stall,
no backwards/untraced/faults; WebKit 3.0 s ready, no stalls or faults.
Both copy all 819 diagnostic entries and report the actual work counts.
First-frame callbacks show world/shadows at 12.486 s, turns at 14.292,
14.312, 14.321 and 14.330 s, then post chain at 14.338 s. No finer
producer callback arrives while the synchronous composer draw runs.

WRITE-RULES.md says: "Three.js, shaders, art, goldens and page UI layout
are for Opus lanes: if a fix needs them, stop at the wire and report what
the page needs." The remaining producer is Game.firstFrame in
src/client/engine/core/Game.ts: it renders the whole post chain before
awaiting another painted frame. Opus must split/prewarm that work and
report real completed draw/fence/pass units at that boundary. The existing
callback is (done, total, detail); preserve exact declared units and yield
where the progress can paint. A timer or guessed percentage cannot solve
this synchronous block. No exception list or relaxed two-second rule was
added. LS7 stays partial, not done. These commits are handoff only.
