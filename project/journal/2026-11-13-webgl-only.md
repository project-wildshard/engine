# WebGL renderer only, no WebGPU (opus-webglonly, J326)

> Written by: Claude (opus-webglonly), 2026-11-13

Jake, ~10:25 Cancún: "Let's only do WebGL renderer. Let's not do any WebGPU renderer. We don't want to accidentally
WebGPU renderer fail and draw nothing."

The game already drew with three's `WebGLRenderer` on a WebGL2 context only (`render/renderer.ts`,
`core/webglStartup.ts`): no Settings choice, URL param or flag picked a renderer. The one WebGPU touch was the
connection doctor, which asked `navigator.gpu.requestAdapter()` and passed the browser row on a WebGPU adapter (or a
WebGL1 context) even where WebGL2, the only thing the game draws with, was missing.

- `host/online/doctor.ts`: the browser row checks WebGL2 only and loses its probe context at once.
- `lint/wildshard-plugin.js` `no-webgpu`, on for every linted file: refuses `three/webgpu`, `three/tsl`, the WebGPU
  addons, `WebGPURenderer`, `navigator.gpu` (member, `in` and destructured) and `requestAdapter`.
- `test/webgl-only.test.ts`: the rule's refusals, and a census that the client builds no renderer but `WebGLRenderer`
  and asks for no 3D context kind but `webgl2`.

Removed rather than gated: there was no WebGPU renderer code to drop, so the hard gate is the lint rule plus the census.

Renumbered J322 to J326: J322 was taken by "No walls" while this lane ran
(commit 9442252c says J322).
