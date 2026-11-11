# QA row 6: B always says something

Jake, 2026-11-10: "B to talk doesnt seem to give any feedback in the
staging.wildshard.io on chrome". Plan: meta `docs/plans/VOICE-CHAT-PLAN.md`
(J218), lane opus-voice2.

Reproduced headless on staging v0.1.6 `ad7b145` at 402x874, desktop Chrome
(no touch). In Driftwood (online) B already worked: the mic turns cyan and
the tip says "You're on voice". The silence was everywhere else:

- a page that runs its own world (the Infinite Wildshard grid until GO3-GO5,
  any offline build) mounts no voice, so B did nothing at all. Jake's own
  follow-up (QA row 14) was exactly this. Now B there toasts why: "No voice
  chat in single-player. Voice is in Shard select's online worlds." on a
  world build, "this build plays offline" on one without a world. The
  online shell is told apart by `redials`, not by repeating the shell
  choice, so GO's grid-online change needs no edit here.
- turning voice off with B only greyed the small mic. Now a 3 s tip says
  "Voice off. Press B to talk again."
- a tip the player had closed (a blocked mic) stayed closed on every later
  press, so a second "blocked" was a 300 ms pulse. A press now clears it.
- a browser with no WebRTC returned before mounting anything. Now B shows
  "Voice chat doesn't work in this browser" for a moment.
- B under an open menu toggled the mic while the menu hides it (QA row 15),
  a mic going live unseen. It now does nothing there.

Same lane, no code: relay-only ICE (`iceTransportPolicy: 'relay'`) calls
connect on staging through Cloudflare TURN (both selected candidates
`relay`, udp 3478), Chromium-Chromium, WebKit-Chromium and WebKit-WebKit,
with decoded audio both ways; WebKit's own getUserMedia (mock device) works
once the permission is granted.

J206 Codex review: no MUST; its SHOULD (cover the real VoiceChat, not
only a stub) is a test that drives VoiceChat through asking, joining,
on, a B off and a server "full". The solo listener is `listenPage` on
the level scope, so it goes with the level like every other one.
