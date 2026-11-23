# HS6c: the server reads `server/plan`

> Written by: Claude (opus-compat-w6), 2026-11-23

The seam HS6a made (`src/server/game/shardfile/serverPlan.ts`) now reads the
server's own `server/plan` section (format HS6b) first, and the page's
`client/plan` only for a file without one: every live shard until the SDK that
writes it (HS6d) ships with the roll. The read goes through an untyped section
name, so it builds against today's format pin. The sided-kind census labels its
rows `plan` instead of `client/plan`. After this, `client/plan` appears in
`src/server` code only as the seam's fallback name; the roll removes it.
