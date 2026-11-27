# Allow staging candidates to read signed releases

QA 11-26 row 48. The candidate proxy's TLS allowlist predates RL10's
release bucket. The v0.1.99 candidate served its title but could not
reach play while the browser's signed release requests were refused.

The tunnel now admits the exact release host from the staging config.
The regression checks that route, the loopback preview, the rooms host
and refusals for other destinations.
