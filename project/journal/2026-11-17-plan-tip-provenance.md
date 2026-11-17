# Refresh hosted plan provenance before main

> Written by: Codex
> **State:** validated locally, 2026-11-17.

Mini QA14 reproduced a hosted land whose exact branch CI passed,
then the pin-provenance hook refused its carried main push. Origin's
fetch config tracked only main and two obsolete CI21 branches. Git's
plan push left the tracking ref on an earlier red tip.

Refresh the specific remote plan ref immediately before each hosted
main push, including retries. Require that fetched tip to equal the
SHA whose hosted CI passed. Replacement or deletion during CI stops
the land before pushing main. Local J400 lands remain unchanged.
The provenance hook still checks the merged test/pins tree and the
matching plan tip's CI; its admission rules are unchanged.

Four real-Git controls failed first: exact and carried pin lands both
hit the original stale-red refusal; replaced and deleted plan refs
incorrectly reached main. All four pass after the fix. The fixture
uses the production checkPinPush decision and SHA-specific verdicts.
Existing provenance controls retain red/pending and mismatched-pin
refusals (8/8 passed). Full land.test.ts passes all 77 cases in
100.09 seconds; the production script passes typed lint. Removed
only the two obsolete CI21 fetch entries from this
mini checkout's local config; main remains its sole default fetch.

No pin files, bypasses, Xcode or licences changed.
