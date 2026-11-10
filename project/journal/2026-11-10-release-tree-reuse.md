# Keep a full proof after its queue snapshot is gone

DS2 carries the queue's actual full proof to a private host cache scoped by
the publishing remote. A separately frozen-installed release clone can read
that proof after the producer snapshot is deleted. Only full results travel;
related and static results cannot cover a release.

The fingerprint includes the actual installed managed pnpm bytes, checked
source tree, host, compiler inputs, runtime, and current exclusion deadline.
The engine self-link refers to that checked tree. Live sibling aliases,
stale installed locks, and unsupported root global stores miss the cache and
run the normal complete gate. No install or link-mode change happens here.

The direct, queue, release, and tag paths execute the same bounded environment
policy. Actual Git refs must still match the checked tree. CI never consumes
these local receipts. The existing exclusion expiry controls remain active.

The real-Git proof installs and runs a real Valibot program, deletes its
producer clone, and uses the actual leftover release helper and normal tag
hook against a local bare remote. The old helper repeated the complete check;
the new helper and tag do not. Exact-SHA red CI still refuses the tag. Changed
source, package bytes, compiler inputs, live aliases, and partial proofs all
refuse reuse. A cache miss runs the actual complete-check entry. This proof
took 5.11 seconds; it performs no release operation on a real repository.

The one-shot review found two real false-reuse defects before publication:
unframed file contents could absorb the next file header, and npr-installed
tools were outside the package scan. Both reproduce red on the initial
implementation. File byte lengths now frame the stream. A read-only adapter
for the pinned npr 2.1 pnpm layout binds its committed install inputs and all
reachable actual tool bytes, including its supported pnpm global store.
Unknown npr layouts miss without attempting an install. A real private npr
install proves a corrupted executable fails and changes the identity; exact
bytes restore it. The framing collision now refuses. These controls take
1.89 seconds. No shared/global package was mutated for those controls.

The release-miss control now retains the engine profile marker and acquires
an actual authenticated full-test lease before running the fixture gate.
It no longer substitutes the generic package branch for engine admission.

The operator's next release remains the end-to-end DS2 observation. This
source proof does not claim the plan's next-release acceptance criterion.

The official renderer revision was regenerated from the committed DS2 source;
the validation revision did not change. Final publication keeps the normal
full hook and its fixed budgets, with one engine queue request for this row.
