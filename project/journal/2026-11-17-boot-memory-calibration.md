# Boot memory probe: calibrate on the renderer (mini-memcal, 2026-11-17)

`scripts/boot-memory-peak.mjs` estimated the iPhone as 0.87 x (Chromium renderer + GPU process). Its "phone" was the
Simulator Inspector x1.4 = 1.845 GB for staging v0.1.36, under the ~2.05 GB line that build crossed on Jake's iPhone
(meta mini QA 19, crash at "boot plan complete ... compile:after", i.e. after worldFrame's compile, before control).

Same-build pairs (v0.1.36 `6f53e748` and main `dc0304da`, Nine rev 2, Low, cold): Chromium's Mac GPU process is ANGLE
Metal IOAccelerator memory, 1.3-4.5 GB on runs of one build, 7-20x the ~0.25 GB of WebGL buffers and textures the page
requested (ANGLE on GL: 0.6 GB; WebKit's ANGLE Metal in the Simulator's SimMetalHost: 0.5-0.6 GB). The renderer is stable
at 1.01-1.08 GB. The estimate is now the renderer peak under the loading card x2.0 (the floor from the crash), on Low.
