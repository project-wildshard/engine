# Voice chat for the two-phone sitting

Jake, after the first two-device session on prod: "How do we add voice
chat for memes ... some kind of button on mobile to toggle voice on, and
on desktop ... some keyboard shortcut, and somewhere near the chat it
should prompt you to toggle it", then "that voice chat is like a tonight
priority btw" (J218, meta docs/plans/VOICE-CHAT-PLAN.md).

Peer-to-peer WebRTC, because two to a few friends need no media server and
an SFU beside the game tick on the VPS would cost CPU and UDP ports the
Tailscale Funnel doesn't carry. Signalling rides the game socket as a new
`voice` control (prefix 8), outside the game protocol, so NET_SCHEMA_HASH
stays put; J54's exact build match keeps client and server agreeing on it.
The main thread relays it inside one cell, because that is where it knows
each seat's cell. An SDP is bigger than the room's 1024-byte message cap,
so it goes in 400-character pieces.

TURN comes from a Cloudflare Worker that mints short-lived Realtime TURN
credentials: the token never reaches a page, the VPS or the signed
release. Without it the server's STUN-only list stands.

The mic button sits at the end of the chat row, so one control is the
phone's HUD toggle and the prompt "near the chat". B toggles it on a
keyboard; nothing binds B. Off by default, nothing recorded, and per-player
mute is the only moderation (MMO-MODERATION is parked).

WebKit gathers candidates before setLocalDescription settles, so a link
holds its own candidates until its offer or answer has gone out.
Playwright's WebKit can't finish ICE on one Mac (mDNS host candidates, no
srflx), so its proof is the iOS Simulator on staging.

The client half: one RTCPeerConnection per peer, the joiner offers, a
chat-row mic button with off/asking/on/talking/blocked states, B on a
keyboard, one tip under chat, and name chips that glow and mute.

The J206 Codex review found three must-fixes, all fixed: offers dropped
while TURN loaded (TURN now resolves before join), a stale hi taking
over a new seat (the hi path is synchronous now, and every await checks
its session and link), and unbounded half-heard pieces (per-peer and
age limits, purged when a peer leaves). Also: the cell cap holds places
for joins in flight, a failed TURN fetch is retried, signalling is
paced at 6 pieces per 50 ms, and a silent offer is retried at 15 s.
