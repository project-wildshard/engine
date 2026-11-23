# Release readbacks carry the agent marker

> Written by: Claude
> **State:** done, 2026-11-22 (meta METRICS MT16, lane mini-mt16).

MT16's hourly Cloudflare audit on staging (19:00 to 20:00 Cancún,
v0.1.72's staging release) found plain `node` requests to `/version.json`:
six from the MacBook while the release ran, one from a GitHub runner at
19:16. `release-train.ts` read the staging page, signed release and health
with an unmarked global `fetch`, and npm-publish.yml's admission steps read
`version.json` the same way. The train now imports `agent-fetch.mjs`, like
`live-status.mjs`, and the two workflow reads send
`node WildshardAgent/1 (ci-npm-publish)`.
