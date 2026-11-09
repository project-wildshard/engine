# An unattended queue must retry races and report failures

The real-remote race proof reproduces the old dropped job in 0.859 seconds:
another main advances during the normal hook, so the checked request is marked
failed and left unpublished. The separate corrupt-record proof reproduces a
later valid request still queued after eight seconds: the worker dies parsing
one earlier truncated file. Its stale capturing record deliberately names a
live PID without holding capture.lock, modeling PID reuse.

Each publication now has at most three checked attempts. A remote advance
after checking causes a normal rebase, frozen preparation and normal hook on
the derived tree. An actual Git ref rejection in the upload race is handled
the same way after a fresh fetch proves the checked SHA was not accepted.
Already accepted SHAs are verified by ancestry; genuinely unknown remote
outcomes remain explicitly unknown. A red hook or changed source is not retried
as a race, and no unchecked tree is uploaded. Original requested SHA/tree and
the last checked derivation are retained.

Malformed and unsafe records become individual failed receipts instead of
killing the worker. Capture liveness uses the real held flock, not kill(pid,0).
Status inspection survives unreadable files. Every terminal non-success also
appends an actionable one-line lane receipt. Tests use private receipt logs so
intentional refusal cases cannot impersonate a real lane failure.

The race CLI actually advances its bare remote after checking, then again
during the real Git pre-push hook. The third derived tree passes normal hooks
and publishes with both upstream advances preserved. Another case continually
advances main and proves three-attempt exhaustion publishes nothing and emits
its failure receipt. Corrupt-record and reused-PID cases fail only those jobs
and still publish the later valid request. The original four-attempt FIFO,
red-hook, dirty-byte and changed-source proof remains green.
