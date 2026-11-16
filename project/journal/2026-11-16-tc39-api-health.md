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

## Combined exact admission and sequential pin setup

Main advanced twice while branch CI queued. The current reader branch
already contains the cleanly rebased TC22+TC28 implementation, so all
three rows now land together with current release, cook and HTTP proof
at the same SHA. This replaces the earlier separate-land order above.

The first land overlapped a still-running pins refresh. Generation read
that incomplete input view and committed truncated boot stamps; normal
pre-push refused the resulting dirt, so nothing reached origin. After
pins completed, a second verified install and input generation restored
all three files byte-for-byte to the pre-generation reader source.
Keep this corrective commit as the audit trail; no hook was bypassed.

Actual-source review confirmed the reader has no source MUST-FIX. Its
branch-consistency finding is resolved by the sequential verified
setup above. Follow-ups add separate proof/live run summaries, use
the selected pin file's API origin, validate the gh fixture's jq shape,
and relax the header-flush timing to the existing deadline. A proposed
static YAML-string assertion was declined: it would mirror the query;
the real qualification query is executed and workflow syntax checked.

Rebase to main3d58034d exposed a false save-definition finding:
journey.spec.ts only seeds the existing devMode key via saveFixture.
Name this exact file in the reasoned OUTSIDE map, preserving production
save discovery and the ABI lock. Existing3case save contract proof
passes. A direct extra lint run outside the declared lint tree finds
two preexisting style errors in the file; no unrelated rewrite made.
The parallel push cancelled siblings after this deterministic save
failure, so the cancelled CLI is not an independent flake claim.
