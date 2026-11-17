# Retry registry requests inside the installed-cook budget

> Written by: Codex
> **State:** repaired locally, 2026-11-17; hosted confirmation pending.

The deadline repair f7edacc024 worked: run44100422223 now retains the
actual failure instead of hanging until its shard loses its report.
Tests (5), job134098636447, fails only the fresh-package cook case:
npm install reaches its original90000ms command deadline. Other12 jobs
pass. The file's98816ms AMBER remains real; the run is RED.

npm's defaults allow300000ms per request, two retries and10000–60000ms
retry waits. A stalled request cannot retry inside the proof's90000ms
command clock. Keep that command clock and all original case/CI budgets.
Use a15000ms request timeout, one retry and1000–5000ms backoff, preferring
valid cached bytes while still fetching anything missing.

A loopback registry serves an actual npm-packed fixture. It leaves the
first metadata request unanswered, then serves the retry and tarball.
With original npm policy the control fails at its unchanged30000ms test
deadline; the source is restored exactly afterward. With the new policy
the real install succeeds in16167.71ms. All five cases pass from a fresh
npm cache in31.09s, including the actual fresh engine install, broken-hook
refusal, healed full cook, and native timeout/cancellation controls.

The original df4285 attempt's subprocess stage remains an inference;
f7's retained phase events establish npm install for the new failure.
No pin, production, assertion or gate-budget waiver.
