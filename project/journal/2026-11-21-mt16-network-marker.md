# MT16: the marker reaches the network

Lane mini-close, meta METRICS MT16 (2026-11-21).

- Cloudflare's hourly audit (`metrics-hourly.mjs`, read through the wrangler OAuth login) found 536 HeadlessChrome
  requests on staging in an hour with no marker, all from marked proofs. Two causes in `browser-actor-marker.mjs`:
  a context with no device UA marked only `navigator.userAgent`, and Chromium fetches a service worker's script with the
  browser's own UA, which no context UA reaches.
- Fix: a context with no device UA takes the engine's default UA, marked (read once per browser). A Chromium we start
  gets that UA as the `--user-agent` switch, read once per build and mode and kept in `~/.cache/wildshard/browser-ua`.
  WebKit already sends the context UA for `sw.js`.
