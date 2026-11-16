# Durable upload verdict and actual game acknowledgement

> Written by: Codex
> State: local source and composed proof, 2026-11-16; hosted and shipment remain open.

SDK-SPLIT SP20b/c2 adds the protected pending feed to the trusted parent.
HMAC binds exact body/method/path/time. Redirects drop credentials, downloads
are capped after decoding and checked against their original hash. A verdict
is fsynced before delivery and replayed byte for byte across restart. Failed
cooks back off durably without becoming permanent byte refusals. Permanent
HTTP refusals keep the full report as a dead letter and stop replaying it.
Private-source bindings are released after each attempt.

The game receiver is authenticated on the existing loopback listener. It
reads signed placement, preloads the exact cooked hash rather than an older
release-book pack, sends updated hashes to live workers and waits for required
cell opening. Occupied rooms keep their lifetime; later room boots select the
new exact hash. A mere cook enqueue never earns a live acknowledgement.

Review: five MUST findings addressed by worker hash propagation, staging-only
rollout (production's existing upload path stays active), durable retry/dead
letters with an 8 MiB API report capacity, and persistent service configuration.
The cook outbox lives under its writable service home. A narrow staging-only
wildshard-config verb installs two fixed credentials from stdin, preserves
production and rolls back on health failure; it prints no secret.

Local composed proof: actual API/PGlite, sandboxed production cook entry,
signed parent transport, exact pack read, actual World/cell host and packed
normal CLI reached live with the same upload id/hash. Lost game ACK stayed
staged, then healed. Proof lives in sharddev test/ci/async-upload-parent.test.mjs;
source qualification is still owed on hosted CI. Six pinned products pass the
full check; a six-product full encoding attempt timed out on Pine and was
invalidated by source edits, so it does not qualify six complete cooks.

Later fixed-source checkout cooks qualified all six products, within the
unchanged600second limit; Pine finished273seconds with four CPU slots.
The landing rebase preserves NB19's eighth inline-author option and puts
the dedicated exact-hash option ninth. Exact activation cannot use inline
inputs; author inline candidates retain their existing source reader.
