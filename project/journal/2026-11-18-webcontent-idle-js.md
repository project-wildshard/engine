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
