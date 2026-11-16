# Read the validator's actual package identity

> Written by: Codex

> **State:** built, 2026-11-16; TEST-COVERAGE TC39 / AP-16.

The API now reports its exact validator package pin (api-server main
0be84b8). Engine must compare that with the resolved package in its
lockfile, rather than a caret range's lower bound or schema version.
The existing format-lock parser owns that lookup; HTTP observation
returns a bounded, explicit mismatch/error receipt.

Eight explicit integration cases cover real HTTP, the actual CLI,
timeouts during headers and body, invalid health, redirects, registry
peer suffixes, git/codeload locks, installed package identity, and a
diagnostic dispatch newer than the scheduled nightly. Tests remain
outside hooks and after blocking wall accounting. A green week and
explicit November 23 or later review precede any admission.

The isolated Ring 2 observer needs no install. Its proof.xml records
the proof week separately from the live report.json, retained fourteen
days. A diagnostic can neither become the regression baseline nor
displace the scheduled nightly used for qualification. The actual API
rollout and reviewed pin alignment stay in meta QA39/MW12 (J373).

Two independent J206 reviews found the original wall-budget placement,
weak redirect control and diagnostic-selection gaps; all were fixed.
The wall-budget correction also belongs to the earlier TC22 branch.
This reader's land waits for TC22+TC28 to reach main with their own
current exact hosted proofs. No local cook or deployment is performed.
