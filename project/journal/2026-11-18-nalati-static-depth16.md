# Phone static bakes keep 16-bit depth (MG11, mini-nalatimem1)

Nalati at control, phone Low, held two 1024² depth attachments for its static bakes (`staticCapture.ts`): the shadow
bake's depth texture (`tBakeShadow`, sampled by the grass rings) at 4 bytes a texel (4.19 MB) and the contact bake's
1024² depth renderbuffer (4.19 MB). On the phone both are now 16-bit depth textures (2.10 MB each). The shadow camera
spans 700 m, so a 16-bit step is about 1.1 cm against the 0.0004 (about 28 cm) bias; the contact camera only orders
casters from above. three disposes a render target's depth texture with it.

## Where Nalati's playing memory goes over Template

Settled at control, one draft run each [K]: Nalati WebContent 752 / GPU 418 MB, Template 436 / 272. WebContent +316 is
WebKit Malloc +257 (mostly JSC heap capacity; the ledger names about 30 of it: audio, canvas, wasm), WebAssembly Memory
(ArrayBuffers) +20, JIT +20. GPU +146 is IOAccelerator +93 (ledger GPU 111 vs 25 MB [L]), owned-unmapped +34 (the
Metal tiler's parameter buffer, sized by the heaviest pass) and owned graphics +17.

Ledger GPU 111 MB [L]: textures 52.5 (rig atlases 14.7: nine 512² RGBA hull atlases at 1.4 MB each, uncompressed because
the SDK's `bake-ktx2.mjs` `CPU_READ` keeps Nalati's rigged GLBs as images, plus the camp people 2.1; engine scene 11.5;
grass ring 8.8; render targets 5.6), buffers 44.6 (dressing 11.6, engine scene 10.8, unattributed 6.7, rigs 4.0, crag
rock 3.2), renderbuffers 14.0 (MSAA-2 composer colour 5.6, the contact depth 4.2, MSAA depth 2.8, depth 1.4). One frame
draws about 3.5 M vertex invocations in the main pass; the outcrops are one 494 k draw, over the 400 k pass split, so
they set the smallest pass the tiler must hold.

## Result

12 alternating locked cold WebKit pairs, phone Low, both arms serving the same prepared Nalati (shard-nalati
`1d5014e`, preparation renderer `e4b639f0`):

| | base | cut |
|---|---|---|
| ledger GPU [L] | 111.2 MB | 107.0 MB |
| settled GPU [K], median | 416.0 | 412.0 (lower in 12 of 12, mean −3.8, se 0.3) |
| settled WebContent [K], median | 767.7 | 775.0 (paired mean +13.7, se 6.6; 8 of 12 higher, sign test p 0.39) |
| EM11 playing upper | 1.093 GB | 1.085 GB |
| EM11 loading upper | 1.443 GB | 1.437 GB |

The GPU saving is the expected one. The WebContent difference has no ledger owner (RAM ledger 77.97 MB in both) and is
inside the run spread. Both uppers fall. The nine phone Low views (road by the camp) match apart from the drifting
clouds.

Next Nalati levers, none landed here: the hull atlases as KTX2 (an SDK `CPU_READ` change, about −12 MB GPU), splitting
the outcrops' one draw (the parameter buffer), the viewmodel sets at 256 on Low (about −11.7 MB, a look change).

## The camp's figure atlas canvas goes after upload

`atlasFigureSkin` packs the camp people's images onto one canvas and kept it after the upload (1.57 MB [L], Nalati's
camp). Nothing redraws it, so it is now `gpuOnlyTexture` (the canvas shrinks to one pixel once uploaded; a lost context
reloads the page). 6 more alternating locked pairs, base against both cuts: ledger RAM 77.97 → 76.40 MB, GPU 111.2 →
107.0; the camp atlas stays on the GPU at 2.10 MB. Paired medians: WebContent −7.2, GPU −7.7, playing high −13.0,
loading high −19.5 MB (playing lower in 4 of 6). EM11 uppers over those 6: playing 1.082 → 1.090 (one cut run read
796 MB WebContent), loading 1.454 → 1.429. The nine views still match.
