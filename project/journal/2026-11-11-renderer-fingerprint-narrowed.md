# The renderer fingerprint narrows to shader inputs (J259, SP3)

Before this, `rendererRevision()` hashed all of `src/client`, `src/shared`,
`scripts`, `public`, `vite` and the lockfile. Any engine commit moved it, so
every prepared shardfile went stale on the next ordinary commit and the stamp
file changed in about 1 commit in 4.

Now it hashes only what decides the linked GLSL a shard's recorded programs
name:

- every committed file under `src/client/engine/render/`;
- every other client or shared source file that writes or patches shader
  text (`SHADER_TEXT`: `ShaderMaterial`, `onBeforeCompile`, `ShaderChunk`,
  `#include`, `#define`, `glsl`, `gl_FragColor`, `void main(`, GLSL
  `uniform`/`varying` lines, `vertexShader`, `fragmentShader`, `patchShader`),
  or builds a three material whose flags pick a program variant (`MATERIAL`),
  so a new one joins on its own (`world/pointLightSkip.ts` is one);
- the files `render/graph/` imports directly: the wind and wave constants it
  bakes into GLSL live in `src/shared`;
- the exact package specs of `three`, `postprocessing`, `n8ao` and the
  `@wildshard/format` pin.

Tests, proofs and `.generated.` tables stay out, as before.

**Today's value is kept.** The 26 shardfiles opus-reprep26 re-prepared this
morning name `e920f041`, the broad fingerprint of `ac225144`.
`CARRIED_RENDERERS` maps the narrowed hash of that tree (`f1c4d5fc`) back to
`e920f041`, so those preparations stay `current`, and the stamp file doesn't
move. The first real shader change leaves the table behind. Pine and Nalati
were prepared on `ebe94ce3` (another broad value, same narrowed hash) and stay
`stale`, as they already were.

Proofs:

- Replay (`scripts/renderer-revision-replay.mjs 86b7e10..c5157283`): it moves
  in 37 of 759 first-parent commits. The cap was 40, and the broad stamp
  moved 187 times. The full import closure was measured too, and it moves
  in 103 to 105 commits, so it's not used.
- Mutation tests (`test/renderer-revision.test.ts`): a one-line edit to
  `render/graph/glsl.ts` or `world/pointLightSkip.ts`, a bump of each package
  and a new `onBeforeCompile` file each move it. An edit under `scripts/`, to
  the lockfile, to a test, or to client code with no shader text doesn't.
- Canary on real recordings: the 26 shardfiles prepared on a `7e3b3342`
  preview (broad `49a01af1`) and again on an `ac225144` preview (broad
  `e920f041`) have the same narrowed hash. All 26 recorded program lists are
  identical with `build` dropped, including Template.

The replay script is typed for the checkJs layer (fix commit after the first push).

Codex review (J206), 3 MUST-FIX, all fixed: `world/painterly.ts` and
`world/backdropLayer.ts` write GLSL with none of the first keywords;
`windField.ts` and `waves.ts` feed `graph/glsl.ts`; and a material flag
(`bakedKinds.ts` `flatShading`) picks a program variant. Each now has a
mutation test. Codex rated a miss as link hitches, never a wrong frame.
