# WebContent JS kept through play (MG9 / MG11, mini-webcontent)

Pine at control held 54 MB of CPU geometry arrays; 23 MB of that was idle `scene:` templates (refs 0, never drawn): the
owned-library revisit copies and the late-weld shapes. Their consumers now `retire` the lease once their copies are made,
which evicts the template when nothing else holds it (owned models only on the phone tier, where memory binds).

A JavaScriptCore quirk, proved with a micro test: a closure made inside a generator body keeps the generator's
parameters alive even when it does not read them (0 of 20 collected; body locals 20 of 20; V8 does not do this).
`placeSteps` and `drawInstancedSteps` built their long-lived closures inline, so every placement's param rows, colours
and matrices lived as long as the placed object. They now build them in plain helpers.

Shader text: `shaderText.ts` kept every finished program text, and three's CSM map kept every compiled shader's
onBeforeCompile parameters, program text included (Pine: 23 fragment shaders, 4-5 MB of strings). The text cache is
dropped at control and the CSM map keeps only `uniforms`.

Pine, 10 locked alternating WebKit pairs: settled WebContent 783 -> 742 MB, EM11 playing 1.018 -> 0.976 GB (upper
1.142 -> 1.123), loading upper 1.571 -> 1.549. Not enough for the 1.0 GB upper alone: the rest of Pine's WebContent over
Template is JSC heap capacity and a diffuse long tail of live cells.

## EM35: prop GLB loans leave the ledger when returned

Main went red on the ledger guard (Coral Drift loading 34.0 MB > 30.7). codex-memgates found 28 compressed prop-tile GLBs,
garbage once parsed, that the weak ledger kept counting until the collector ran. `ClientAssets` now counts loans
(`read` / `returned`); a buffer no reader, wire entry or cache write holds leaves the ledger at once. Coral reads 24.99 MB in
every boot, Clockwork 19.03.

## Owners at control, Nalati and Pine against Template (mini-webcontent2)

Heap snapshots of an unminified build (headless Chromium, ANGLE Metal, phone Low, two GCs at control) were walked as a
dominator tree with each ArrayBuffer store charged to its retaining chain. Nalati holds 160.7 MB of ArrayBuffers and
Template 20 MB; the JS cells differ by only 26 MB and no single owner of cells passes 1.6 MB.

- **Retired scene templates stayed live.** `worldScenes` ran its `finish` list of lease `done`/`retire` closures but kept
  the list, and the scope it lives in stays live through play. `retire` captured `source`, and every closure of a lease
  shares one scope, so each retired template kept its arrays (Pine ~8 MB of position, normal, uv and colour). The list is
  emptied as it runs and a lease names its asset by id, dropping its release hook once done.
- **Nalati's boss chamber copied its static shell.** The arena deep-copied each fixed-draw template it uses, and the
  shell's 333k-vertex copy (12 MB of float position, normal and colour) waited beside its template until the player
  entered. Every shape but the sand now draws a view over the template's arrays (`shareOwnedGeometry`); the view's own
  attribute objects take the GPU buffers and the release after upload.

Chromium [H] at control: Nalati ArrayBuffers 160.7 -> 147.0 MB, Pine 119.5 -> 109.8.

WebKit, engine `0601e1ac` against the cut, alternating cold pairs under the shared measure lock, settled WebContent
median [K] and EM11 upper (playing / loading):

| Zone | Pairs | WebContent | Playing upper | Loading upper |
| --- | ---: | --- | --- | --- |
| Nalati | 10 | 781 -> 759 MB (paired -14.5) | 1.09 -> 1.07 | 1.44 -> 1.43 |
| Pine Hollow | 20 | 746 -> 735 MB (paired -8) | 1.10 -> 1.09 | 1.52 -> 1.52 |
| Driftwood | 10 | 719 -> 693 MB (paired -25.5, 10 of 10 lower) | 1.07 -> 1.00 | 1.37 -> 1.36 |

Look at phone Low unchanged: WebKit spawn shots 4 s after control differ in 0.12% (Nalati), 0.14% (Pine) and 0.06%
(Driftwood) of pixels, the animated grass and water. Nothing drawn reads a retired template; the chamber's views keep
their CPU positions for picking and collision until the sand's own copy is written.
