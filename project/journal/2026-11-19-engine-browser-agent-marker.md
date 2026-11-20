# Mark engine browser proofs
> State: implemented, 2026-11-19.
> Written by: Codex

METRICS MT2 shares one marker across the portable Playwright adapter,
SafariDriver, Web Inspector and game URLs opened by Simulator or
Android. Marked contexts preserve an explicit device user agent and
carry the agent header. The private Safari two-frame readiness
challenge keeps its exact loopback URL. A real iPhone-profile
Chromium context sent the marker and original device identity to a
loopback server.
