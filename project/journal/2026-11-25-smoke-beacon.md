# 2026-11-25: the smoke ignores the Cloudflare beacon

Staging K6 played all seven cells and still held on one P1: headless
WebKit called Cloudflare's analytics beacon post (refused cross-origin) an
uncaught page error. That's Cloudflare's script, not ours, so the
page-error check drops cloudflareinsights.com messages through one small
rule in `scripts/staging-smoke/thirdParty.mjs`. hud-worst flags the same
beacon as a foreign request (meta QA 11-24 row 65) and can import it too.
