# Doctor reports the signed progress epoch

> Written by: Codex
> State: locally proved, 2026-11-17.

The epoch-2 main tool rejected production v35's valid epoch-1 page,
and both PASS receipts still printed epoch 1 after admitting epoch 2.
The proof now checks a positive page epoch against the signature-verified
release and reports that same value. Build, channel and signature guards
remain. This lets one release tool verify both sides of the staged cut.

Eight Doctor/epoch-cut controls, lint and types pass. The updated tool
also passes its real read-only production35 publication proof, reporting
epoch1 and zero production sockets. The original mismatch log is kept.
