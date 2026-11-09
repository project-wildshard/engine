# Isolate agent play from the human sitting

J205 makes live agent proofs staging-only. No agent play socket was
opened on production in this preparation. The production sitting page
remains https://preview.wildshard.io, in named project wildshard-e7,
on tag v0.1.3/full 5baa0faa2eac4c00f00174a72189b07852089b06.
Its page/release stamp, epoch 1, signature and public book verify.
The exact tag producer 42689938033 is green after the socket vars landed.

The production book and all 105 content-addressed server parts for 28
products plus the grid are public and verified: 89,804,828 Brotli wire
bytes, decoded hashes and lengths, file ranges and preview CORS. Parts
went first and the exact generated full-SHA book last. No loose product
URL may disappear: the page publication restored the known 2,098-file,
165,089,794-byte URL closure before packaging. Public source maps are
omitted from the deployment artifact; original dist maps remain intact.

The separate named project wildshard-e7-staging serves
https://staging.wildshard.io. Its signed channel is staging.json and its
only allowed socket is wss://wildshard.tailb41b20.ts.net:8443. The origin
had no prior Vercel alias. This separation keeps service workers, browser
storage and the human page out of the agent proof. No auth grant was
created and no protected environment value was copied or committed.

The packs Worker source already allowed staging in f82f65a, but its
live deployment did not. Clean, CI-green leftover 8424b9c was deployed
as Worker version 4d229f26-e152-443b-ae14-b70b692b3b0e: seven existing
HTTP tests and the staging preflight pass; actual release/book GETs now
return the staging CORS header. R2 metadata and signed files stay intact.

The staging channel advanced naturally to green 32f182d/serial 2 while
the first page was deploying. The manual proof refused before opening a
browser rather than mixing builds. The staging page and book now match
32f182df49688e4e70331dc33d5f7a4e66566220, epoch 1. Its 105 parts are
identical and were verified, not rewritten. The production page remains
on the tag. At the last health observation the staging server still
served 5baa/serial 1; its normal prepare/restart is owned by codex-j189.
No live play pass or soak is claimed until that source binding settles.

Manual scripts/e7-live-staging-proof.mjs requires the staging origin,
verified signed staging channel, exact page/server SHA and serial before
opening a browser. Native WebSocket construction refuses any other
host/port before connecting; successful traffic uses unchanged browser
TLS and protocol. Real names, bodies, keyboard movement and chat are
required. Every page/console error remains a failure. Chromium carries
both keychain flags; both engines use muted iPhone portrait contexts.
A production-origin negative control refuses before fetch/browser;
syntax and the complete scripts TypeScript project are green.

The first real staging Chromium pair saw both bodies and Names. Its
movement probe then released the key after a non-idle gait before its
own authoritative pose changed. Require actual walk/run gait and actual
authoritative displacement together while the key remains held, within
the same 20-second bound. The displacement assertion is retained; no
world placement, command, backend or game timing changes. The original
refusal is not claimed as a gameplay pass.
