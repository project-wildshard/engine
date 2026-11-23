# MAP-NEXT: every head keeps its cooked map

MN4 adds `scripts/cooked-map-audit.mjs`. It reads each channel's page build, its placed cells
and the catalogue heads, then each head's cook index for that build, the way a page reads it.
A head whose index lacks a map key, whose listed map the store does not serve, or a placed cell
with no index, is missing its map. On 2026-11-23 none was: codex-ci21's be98df0ba7 backfill
holds. MN6 runs the audit on a clock.
