# One navmesh, the server's (ENGINE-MEMORY EM20)

> Written by: Claude (lane mini-em20)

EM20 asked which zone data the page and the standalone server's worker both hold. Heap snapshots of both isolates at
control (Chromium, phone tier, Low, `4be04aa5`) answered it: the navmesh. The page built one in `bootstrap.ts` (and the
grid in `liveSession.ts`) from the same WSNM bytes the server builds its own from, yet every query lives in the server
(`ai/huntPattern.ts`, `server/game/population/*`). On the page only the `?navmesh=debug` overlay and the probe's `nav`
read it. Nalati's is 8.69 MB of JS objects [H] in each isolate from 271 kB of bytes; Nine's 0.19 MB; Template has none.
Every other string the two share came to 0.13 MB, and the worker's zone part on Nine is only about 1.7 MB in all.

`navmeshLoad.ts` now builds the page's copy only on `?navmesh=debug` or `?navmesh=page`, and imports navcat and the
navigation parse only then, which also takes 44,670 bytes off the session closure (raw 4,393,468 to 4,348,798).

WebKit [K], 4 alternating cold runs: Nalati settled 1,002 to 976 MB and peak 1,288 to 1,246; Template and Nine unchanged
within noise. T1 phone 7/7, boot and journey pass.
