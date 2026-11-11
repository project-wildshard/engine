# The Sunscar Dunes render crash: shared light uniforms

SENTRY-TRIAGE S2, `WILDSHARD-GAME-84`: a fatal `Cannot read properties
of undefined (reading 'position')` inside three's struct uniform upload,
every frame, until the render system's faults stopped the loop.

The plan's lead was LightPool's fixed count. The count isn't the bug:
three rebuilds a program when the light count moves. What three does not
expect is two materials sharing one light-uniform holder. `getProgram`
points `uniforms.pointLights.value` at the arrays of the render state it
binds in, and skips that on later draws while the material's program and
light-state version stand. A cell clip variant was made with
`{ ...material.uniforms }`, and a graph material's copy kept every
non-own uniform shared, so a variant and its source held the same light
holders. The clip variant is then linked by the page precompile, which
compiles against its own scene of copied lights, snapshotted when the
job was made. When that count is below the page's (the page grew a
light after the snapshot), the precompile repoints the shared holder at
the shorter arrays, and the source's next page draw uploads them to a
program built for more lights: `undefined.position`.

The fix: `lightUniforms.ts`'s `ownLightUniforms` gives the clip variant
its own light holders, and `GraphShaderMaterial.copy` does the same;
every other uniform stays shared as before. The draw guard in
`drawHooks` takes only that case: a lit draw's TypeError when the bound
program reads more light entries than a holder has. It marks the light
binding stale, unbinds the current program so the redraw uploads every
light, draws once more and reports once as a `retry` fault
(`render.lights`). Any other error, or a second throw, goes on as before
(the J206 review's two MUSTs: a version reset alone left lights 1-3
unuploaded, and any lit TypeError was being swallowed).

The frame itself is still minified in Sentry; S5's map upload lands
beside this, so the next such event names its file. The test emulates
three's binding and struct read, and fails without the fix.
