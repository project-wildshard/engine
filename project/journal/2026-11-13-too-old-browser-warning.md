# Too-old browser is a Sentry warning, not a fatal

WILDSHARD-GAME-8F: a Chrome Mobile 133 on Android hit "This browser is
too old for the online world" and Sentry got it as `fatal`. That's the
page doing its job: J171 keeps signature code out of the browser, so no
WebCrypto Ed25519 means no online world, and the player is told to
update. Nothing to fix in the browser.

So `browserErrorLevel` in the telemetry module decides the level: a
designed old-browser refusal is `warning`, anything else stays
`fatal`/`error` as before. Both capture paths use it. It matches the
phrase with `includes`, not `startsWith`, because a title drop wraps the
reason as `<what>: <reason>` (review caught that). The online-shell test
pins the real thrown error from `readSignedRelease` to `warning`, so the
release message and the telemetry phrase can't drift apart silently.
