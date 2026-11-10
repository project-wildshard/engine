# Keep a full proof after its queue snapshot is gone

DS2 carries the queue's actual full proof to a private host cache scoped by
the publishing remote. A separately frozen-installed release clone can read
that proof after the producer snapshot is deleted. Only full results travel;
related and static results cannot cover a release.

The fingerprint includes the actual installed managed pnpm bytes, checked
source tree, host, compiler inputs, runtime, and current exclusion deadline.
The engine self-link refers to that checked tree. Live sibling aliases,
stale installed locks, and unsupported global stores miss the cache and run
the normal complete gate. No install or link-mode change happens here.

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

The operator's next release remains the end-to-end DS2 observation. This
source proof does not claim the plan's next-release acceptance criterion.
