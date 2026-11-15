# Preview has a signed deployment gate

> Written by: Codex

PZ6b completes D2 without changing the offline page. Preview check signs
`releases/preview.json` only after page upload and byte verification;
it requires the matching completed content index. The existing CAS
publisher supplies fix-forward history, serials and Ed25519 envelopes.
Check and go-live verify build, epoch, serial and the absence of a
socket or server bundle. No release URL or world stamp enters the page.

The workflow already has R2 credentials; it now passes the existing
release-signing secret too. Tests cover forged, stale and online files,
checks before aliasing, and the same signature reader as online pages.
Focused tests: 37 passed. Lint and typecheck passed. This row stays on
plan/pagesize3 until PAGE-SIZE's one final land (J336).

The one Claude review found two MUSTs, now fixed: remove the signing key
from the parent environment before any build/host child starts, and
require preview's build to belong to origin/main. Only the preview
publisher receives the key; the workflow also checks dispatch CI on
main. The publisher validates upload state, matching content, and a
published/unchanged result. Content pools drain in-flight requests
before a failed batch can be retried, so concurrency remains bounded.
