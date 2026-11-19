# Nine's load garbage, named and partly cut (meta IPHONE13-REAL-TEST IP31)

> Written by: Claude (lane mini-nine-loadgc), 2026-11-19

IP30's byte budget moved Nine's worst WebKit boot only 33 to 69 MB, and its ledger explained a fraction of the
transient, so this lane counted the garbage itself. A sampled allocation hook in the page (typed arrays, buffers,
fetch bodies, JSON, decodes, worker messages; one stack per ~256 KB, a WeakRef to say what outlived the boot),
mapped through the build's source maps, plus V8's sampling heap profiler as a JS-heap proxy. Nine's top garbage,
sky to readyFrame: the held files copied three times on their way to the reader (the store's cache re-read, the
`new Response(bytes)` copy, and `contentRead`'s stream copy: ~170 MB for ~60 MB of files); placement-page JSON
(~108 MB of JS heap in Chromium); spawn part bodies (80 MB, dead once their members are stored); meshopt decodes
(~80 MB, dead after upload); worker messages (75 MB, half of it the slab tree).

`boot/lentBody.ts` lends a held file to its one reader: the store's Response carries the bytes themselves and
`contentRead` takes them whole. The same switch wires EM17's placement text path again (unwired by `d11afc8f`
until the dead buffers it waited on were cut). Both sit behind the device slot `debug.loadGc`, off by default:
locked WebKit phone-Low pairs moved Nine's worst boot 62 MB alone and 80 MB with IP30's budget (median 98), short of
the 200 MB line; Pine's moved 226 MB with IP30. Nine's late peak now sits at the readyFrame refinement and the
program links, where the GPU process carries ~570 MB.
