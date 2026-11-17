# Staging smoke (meta STAGING-SMOKE, J398)

- SM1/SM2 (opus-smoke): scripts/staging-smoke.mjs runs K1-K5 headless, one browser at a time, and checks.mjs gives each finding P0/P1/P2; hold on P0/P1. K3-K5 clean on a local build (46/21/18 s); a menu-loop stub fails K3. Browser tests run only by name (WS_SMOKE_BROWSER=1, WS_SMOKE_BUILD=<url>). Surprise: a zero-height .ws-title-stack is not "visible" to Playwright, so the stub needed it sized.
