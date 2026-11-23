# Update-boot caches keyed by content, not the deploy

> Written by: Claude (opus-perf), meta QA-FEEDBACK-2026-11-23 row 8.

- Jake: "its only frozen and really fucking slow when doing a version upgrade or update". Two of the boot's caches were
  keyed by `__BUILD_ID__`, so every deploy threw them away even when nothing they hold changed: the shader-source book
  (`shaderSourceStore.ts`, phone Low) and the built-Home geometry (`homeBuildCache.ts`, every tier). Both now key by the
  code their entries depend on: the book by the renderer revision (already stamped as `__WS_RENDERER_REVISION__`), the
  Home by a new Home geometry revision (`scripts/home-geometry-revision.mjs`, stamped as
  `__WS_HOME_GEOMETRY_REVISION__`). No stamp (dev pages) keeps the build key.
- The rest of the boot's caches already survive a deploy: content-named chunks under `b/c`, the asset and content caches
  (URL-keyed, content-addressed), recorded programs (renderer revision). The service worker's shell cache stays per build
  (fonts only). A forced upgrade (minClient, J383) still wipes everything on purpose.
- Proof rig: `scripts/loading-flow/update-boot.mjs`, headless WebKit 402x874, two builds of one tree behind one origin,
  alternating so each round reads two updates and two warm boots.
- The Home list is narrowed by hand like J259's renderer list; a file that changes how Home geometry is built joins it.
