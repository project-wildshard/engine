# MAP-NEXT: every head keeps its cooked map

MN4 adds `scripts/cooked-map-audit.mjs`. It reads each channel's page build, its placed cells
and the catalogue heads, then each head's cook index for that build, the way a page reads it.
A head whose index lacks a map key, whose listed map the store does not serve, or a placed cell
with no index, is missing its map. On 2026-11-23 none was: codex-ci21's be98df0ba7 backfill
holds. MN6 runs the audit on a clock.

MN5: a cook never ends without a map. When the world render throws, `cookedMapPngs` draws the
terrain's heights, hillshaded, with the declared water; when that throws or covers nothing, a
ground-colour map with the zone's outline and its name in a 5x7 capital font. A write failure
still fails the cook. The worker refuses a job report that has no map, so no index without the
cooked-map-v1 keys is published again.
