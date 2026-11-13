# 2026-11-13 iOS http stall

Jake's iPhone (Chrome iOS) showed staging as WILDSHARD and the hero, nothing else. The tab was on plain
`http://staging.wildshard.io/`, which Cloudflare served with a 200: no secure context, so `crypto.randomUUID`
threw and the title never mounted its buttons (headless WebKit at 402x874 reproduced it; https was fine).
Cloudflare's Always Use HTTPS is now on for the zone. The engine's first head script (`data-secure-door`) also
moves a public http host to https, and shows a plain line where there is no https twin (a LAN dev server).
