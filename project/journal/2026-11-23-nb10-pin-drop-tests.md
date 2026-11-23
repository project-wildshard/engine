# 2026-11-23 NB10: a pin drop refuses while tests name it (opus-compat-w10)

SHARD-COMPAT NB10 audit gap: retiring a shard left engine test lists naming it, and main went red after the drop. `pin-shard.ts --drop` and `pins.ts refresh --drop` now scan test/ (whole slug, code lines) and refuse with file:line rows; a slug frozen for tests is exempt; `ALLOW_PIN_DROP_TEST_NAMES=1` is the J381 hatch for a refusal test that names an unpinned slug on purpose.
