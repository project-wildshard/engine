# AC11: play's /api calls go to api.wildshard.io

- API-CLOUDFLARE AC11 (opus-ac11). `VITE_API_ORIGIN=https://api.wildshard.io` in deploy.yml's workflow env and in
  page-release's `buildEnv`, so every channel page posts errors, telemetry and the inbox to the api-server Worker
  instead of the Vercel shell's functions. OFF-VERCEL OV8 needs this before play moves to Cloudflare.
- The recovery build stops requiring `.vercel/output/functions/api/*`; the 401 probe asks the Worker.
- The boot smoke and phone route stub the API with CORS and answer preflights: the page now calls another origin,
  and an unstubbed error report would otherwise reach the real API from CI.
- Local check: a build with the origin set, loaded from `https://preview.wildshard.io` in headless Chromium, posted
  errors 200 and telemetry 200 to the Worker, and the inbox answered 401 readable (no CORS error).
