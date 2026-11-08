# Native fence counterexamples hold the Opus LS7 tail

Reviewed d9c38da/907ae63 directly, then exercised the exact committed
fence class with a real game GL context and real child Scope. Chromium
and WebKit both reproduced a pending drain and one live undeleted sync
after owner disposal, and one falsely completed unit after genuine
WEBGL_lose_context loss with no fence created. The temporary probe
observed and forwarded native calls; no renderer source was edited.

The review also identifies active weights without individual measured
sources. Both Opus commits remain NO-GO. The detailed source, evidence,
limits and required fixes are in docs/reviews/ls7-codex-review.md.
