# hud-worst shoots staging (HUD-TIDY HT3)

`scripts/hud-worst.mjs --base=https://staging.wildshard.io/ --chunk=<instance>` now runs the worst-case HUD and the
`--tidy` checks against the staging page, marked as an agent, answering the title's name box first. HT3 proved HT1 and
HT2 on v0.1.85 this way (Sunscar Dunes and Nalati, WebKit and Chromium, 402 x 874). On staging the union check still
flags its own injected chat row against the page's real one, and the Cloudflare beacon as a foreign host: the tidy
checks are the ones that count there.
