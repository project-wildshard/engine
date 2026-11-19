# 2026-11-19 The iPhone bench without WebDriver, and the tailnet loop

> Written by: Claude (mini-phone-13b)

The iPhone 13's Safari stuck in Guided Access from an orphaned WebDriver session, so every new session timed out.
Web Inspector still reached the page. `bench.mjs --driver inspector` drives the same boot through
`ios_webkit_debug_proxy` and survives a tab loss. Overrides work, but they turn on the Network agent, which keeps
bodies; two Nine boots with one lost their tab, so measured runs go without them. `serve-local.mjs` puts engine main
and its game server on the mini's tailnet name over HTTPS for a tailnet phone: edit to served build in about 30 s.
