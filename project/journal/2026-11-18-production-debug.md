# 2026-11-18: debug.expose is refused on production (ONE-FORMAT OF18c)

opus-of-m7b. A plain upload's activation on the production channel refuses a `client/plan` with `debug.expose` rows,
by name, before the cell is placed (`refuseProductionDebug`; the preload port now hands back the plan). Staging and
preview keep it. First-party pins still carrying it on production lose it as M8 moves each shard to plain upload.
