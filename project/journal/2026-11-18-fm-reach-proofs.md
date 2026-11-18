# Failure proofs for reach, voice and sleep

> Written by: Claude
>
> **State:** built 2026-11-18, opus-fm (paused at Jake's Opus cap), meta MMO-FAILURE-MODES-PLAN FM4b and FM8.

`failmode-proof.mjs` had no runner for modes 5 to 8 (parked on the
design call) and none for voice (no two-peer harness).

Modes 5 and 8 refuse the world's upgrade at the proxy from the first
dial. Modes 6 and 7 sign the page's release view with another socket:
a `.invalid` name, and the proxy's TLS listener on an owned self-signed
pair (`--tls-cert`, `--tls-key`), which counts the handshakes the
browser refuses. All four must show `unreachable`, say the game's site
answers, name no cause, and seat once healed (6 and 7 through the
release read again and Try now). Chromium passed all four.

Voice: two real pages with a fake microphone, the voice worker's TURN
list answered empty by the page route (no STUN leaves the Mac). One page
alone past the give-up clock shows nothing; the two link directly; then
a labelled page-boundary fault drops remote ICE candidates on both, and
the tip shows on its own clock while a chat line still arrives. Try
again with candidates allowed links them. Chromium passed 32.

Mode 45 had no card on loopback because a healthy redial seats inside
SB31's quiet second. The proof now holds the world's door shut from the
freeze until the card shows, after a 2.5 s healthy-freeze control.
Mode 4 never passes on a freeze alone: headless Chromium keeps the page
visible. Mode 42 adds an unknown-clock control (version and health
reads stalled: clock unknown, no warning).
