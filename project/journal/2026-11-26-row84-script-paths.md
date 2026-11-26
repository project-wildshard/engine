# Script paths: engine's five fixed, the guard enforced (opus-chunk2, meta QA 11-25 row 84)

- repo-kit's script-path guard named 9 here. Four were the guard reading code inside strings (authored-manifest's
  generated source, online-rig's node -e body, module-cache-proof's module body, gate-related-tests' optional folder);
  repo-kit 1c8ab32 fixed the guard.
- ci-native-fixtures.mjs is retired: it imports three nalati native fixtures that never came into engine, and nothing
  runs it (no workflow or script; the ci-native-cache fixtures are stored copies). It leaves both tsconfigs.
- crossroads-rig/phone.js imports config.js, which scripts/app-build/crossroadsRig.ts writes beside it at build time:
  the line says so (`// script-paths: …`).
- parity.mjs read its pending list from project/archive/game-normalization/reviews/pending.json, which stayed in
  singleplayer (an empty list); it is test/parity/pending.json now.
- lint:game runs the kit's .githooks/script-paths.mjs with an empty baseline, beside the chunk guard.
