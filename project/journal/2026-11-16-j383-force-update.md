# J383: escape old cached shells without a phone chore

Jake's Home Screen app kept v0.1.22 while staging served v0.1.29. The
emergency worker requests takeover at install and, for registrations without
the new completion marker, skips all precaches, wipes Cache Storage and the
compiled-home IndexedDB cache, claims clients and navigates each at its exact
URL. A blocked database delete cannot deadlock activation. Settings, account
storage and every wildshard-saves database remain intact.

version.json now publishes minClient=0.1.24 and the declared package client
version. The document stamps that declared version separately from git
describe, preserving the renderer stamp. Boot and foreground check the fresh
minimum. Retired clients show Updating, unregister/wipe and reload, with a
four-second bound and planned-reload bookkeeping. Concurrent foreground reads
coalesce so a raised policy is not lost behind an older in-flight read.

The read-only Claude review found two MUSTs, both fixed: normal staging and
preview cleanup now preserve the marker; concurrent wipers ignore the fresh
marker and a persistent derivative-cache refusal gets at most one retry per
tab session. The session key is registered in the save service. The recovery
controller is an instance, so tests need no module mocks.

Six persistent WebKit 402x874 profiles primed with immutable shipped v0.1.19,
the exact v0.1.22 ad3996fc, and v0.1.23 bytes escaped in one launch in both
browser and standalone-style modes (1.486-1.516 seconds on the first matrix).
All retained account/settings/game-database sentinels and removed the old
download and compiled-program caches. Native CSP prevents remote API writes
and game joins without Playwright interception changing service-worker
behavior. The final iPhone 17 Pro user-agent matrix against clean e1c2d224
passes all six profiles: v19 browser/standalone 1518/1520 ms, exact v22
1529/1513 ms, v23 5668/6752 ms. Every case uses updateViaCache=all and one
external launch. A native worker may interrupt the priming navigation; the
proof accepts only that interruption, then still asserts the legacy build
and controller before seeding. No scripted reload occurs after switching
the origin to the candidate. Hosted CI qualification follows.
85 focused cases, lint, types and CSS passed before the final intent marker.

No hook escape hatch was used. v0.1.30 was already cut; this rides v0.1.31.
The physical staging playtest is PZ30/PZ11, and asks Jake for no chores.

Final indicator correction: J383 asked for a tiny Updating line. Keep the
existing screen visible and place the status above the bottom safe area,
without covering the viewport or taking pointer input.
