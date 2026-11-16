# Zone entry, opus-gcm15 (ZONE-ENTRY-PLAN, meta)

- **ZE7c, the grey Pastel and Ink-Cel props.** Both shards draw their props with the `rock` graph as the props family. The
  family variant (`declaredProps.ts` `acquireVariant`) switched three's `vertexColors` on because the template's GLBs carry
  colours, so `color_fragment` multiplied the graph's pink-to-peach (Pastel) and paper (Ink-Cel) by the measure grey 0.246.
  A graph reads the mesh's colour itself (`vertexColour`, `wsVertexColour()`), so a compiled graph now records whether it
  reads it (`GraphShaderMaterial.readsVertexColour`) and a family variant of one that does not keeps `vertexColors` off.
  Graphs that read it (Nine's facade, the open plots' paving) keep today's multiply: on the family path they are multiplied
  twice (the graph's own read and three's), which is a look change to make on purpose, not here.
