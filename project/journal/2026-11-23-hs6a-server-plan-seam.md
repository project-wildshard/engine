# HS6a: one seam for the server's client/plan reads

> Written by: Claude (opus-compat-w6), 2026-11-23

Eleven server files read the page's `client/plan`. They now read it through
`src/server/game/shardfile/serverPlan.ts`, so HS6c can move that one file to a
server section and `client/plan` goes back to page-only.
