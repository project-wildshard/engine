# Pine r6 staging cook

Written by Codex. QA29, 2026-11-19.

Staging v0.1.48 queued Pine r6 at 04:12:47 Cancún. The child hit its
900-second limit at 04:28:11. The old worker logs only the final
failure; its child phase markers are now retained on job exit,
including when the watchdog kills the process.

The exact 313,806,336-byte archive from Pine publish 44430759384
hashes to 86c0ecc51749. Its cold phone tier encodes 144 distinct
textures (39,814,144 top-level texels) after replacing its hand-baked
overlays. The measured macOS cook spent 1.1 seconds in admission and
proof. Texture preparation took about 875 seconds with one lane and
430.5 seconds with two. Both then encoded client and server packs.
Asset selection, encoder settings, layer sizes and isolation flags
stay the same.

The VPS service is pinned to CPUs 13–15. The previous fallback set
aside two and ran one encoder lane. The service now passes its known
affinity through the existing grant and the child gets two lanes.
Allow 1,500 seconds for cold encoding and the packs that follow.
That gives the shared VPS more room for variation than the old
900-second deadline while keeping a finite child watchdog.
