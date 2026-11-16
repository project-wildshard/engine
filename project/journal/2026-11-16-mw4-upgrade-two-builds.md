# 2026-11-16 TEST-COVERAGE EG-32 / MACBOOK-WAITS MW4: upgrade-two-builds (mini-nb3)

- `scripts/loading-flow/upgrade-two-builds.mjs`: two serve-build previews behind one switching proxy (same origin, so the
  old tab keeps its service worker, caches and saves across the "deploy"). The old build serves the title and SHARD SELECT,
  the proxy switches, the old code presses ENTER WORLD. Pass: a new-build document loads and reaches control (or holds the
  title 10 s) within 100 s, no `Build must publish source residency` (BUG-15), no control without a reload.
- v0.1.29 `a1adf711` -> v0.1.31 `5e0fb5ef` on the mini: control on the new build 10.3 s after the deploy, one refusal
  bounce (`/?chunk` -> `/` -> `/?chunk`), no console errors. Not in Ring 2 yet: it needs a second (previous-release) build.
