# The glow cards are declared on the model contract

> Written by: Claude (opus-qa-engine), 2026-11-28

QA 11-25 row 153's glow cards (`96f0d2e35`) gave `render/lookLight.ts` a second `InstancedMesh`. `check-models` holds
the shared code to its declared counts, and lookLight declared one (the pools of light), so main's `tests (6)` went red
on `test/model-contract-paths.test.ts` (run 46107927664). The push gate never ran that test: it reads every source file
by path, so Vitest's related selection finds no import edge to it. The fix declares the cards (an effect, like the lamp
halos in `lookRender.ts`), and the guard is a push edge: any non-test source file now runs the model contract at push,
with a row in `test/push-path-edges.test.ts`.
