# Refuse a promisor source before queue capture

Queue62 belongs to codex-port's blobless e7-sitting clone. Its source
upload-pack could not serve old blob cf7fb22: lazy fetching is disabled
while the queue's independent anchor fetch captures the complete history.
This failed before install or any hook. It is not a test, lease or broker
failure, and dirty shared checkout files are unrelated.

A new explicit outside-hook CLI proof reproduces the same real failure
with a file:// blobless clone whose HEAD is checked out but whose old
history blob is absent. The old queue allocates a job and reaches the
same lazy-fetch-disabled/bad-pack error instead of a named source refusal.

Enqueue now inspects Git's actual partial-clone/promisor/filter settings
before creating any queue directory, sequence, job, anchor or snapshot.
Capture rechecks inside its serialization lock. A configured partial
source refuses clearly and directs its owner to use a full clone without
promisor/filter settings. No credentials, network hydration or implicit
source mutation is introduced. A source with only an explicitly false
promisor flag remains a full source.

The real proof is green in 0.85 s: the partial clone has an actual missing
old blob, refusal leaves no queue path, and a separate full clone runs
its real unchanged pre-push check and drains its snapshot. The fixture
uses disposable local Git remotes and a complete tiny input assertion,
not a mocked fetch or production hook bypass. It stays outside automatic
hook/test discovery. Full normal publication is still required.
