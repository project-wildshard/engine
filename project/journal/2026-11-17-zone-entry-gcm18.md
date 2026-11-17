# 2026-11-17 zone entry, staging proofs (opus-gcm18)

- The zone proofs now have staging forms: `zone-gate-proof.mjs` walks a guarded guest seat from Driftwood's spawn to any of its
  four neighbours' gates; `road-drive-proof.mjs` walks a staging seat to the east entryway; the last chunk walks back in.
- `zone-pair-proof.mjs` watches one gate entry from the road (B) and from inside the target (C). On staging v0.1.33 it passed:
  one socket, no reload, B saw A frozen 10.5 s then gone, C saw A arrive 5 m away. Its failing runs were the harness: several
  WebGL pages in one headless browser starve a page's game loop while its socket keeps receiving at 60/s, and four clients on
  one IP meet the door's 4-socket cap.
