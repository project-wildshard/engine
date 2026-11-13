# 2026-11-13: Chromium launches are muted

Jake (14:45 Cancún): "tell everyone to do headless chromium with volume off". `KEYCHAIN_ARGS` in
`scripts/chromium-keychain.mjs` now carries `--mute-audio` beside the two keychain flags, so every launch that spreads
it is muted without its own edit. The source guard (`scripts/chromium-keychain-check.mjs`) checks literal flag lists
against `KEYCHAIN_ARGS`, so a hand-written list that keeps the keychain pair but drops the mute is refused. WebKit has
no mute flag and stays as it is.
