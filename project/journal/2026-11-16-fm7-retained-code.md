# Sign the code a page actually carries

FM7 signs code-retention.json from deploy-chunks.json after the carry step.
The graph has one to five distinct exact build identities, current included;
every named file must exist at its carried length. The publisher verifies its
Ed25519 key against the release trust root. The normal page-release CLI runs
this isolated signer before packaging, and its local/deployed document gates
include the new file before an alias can move. Build tools never inherit the
private key. Legacy flow callers without this feature remain supported.

The WebCrypto reader checks the signature and a freshly verified release's
channel/build. Missing legacy metadata stays unknown. Kept code says nothing
about compatible game schemas. Unscheduled alias changes have no authoritative
retirement timestamp: issuedAt is signing time, never a fabricated countdown.
An authenticated future scheduler can supply retireAt; today's producer omits
it. FM5b owns the actual warning and deferred update presentation.

The native producer/reader proof passes. Thirty-seven targeted tests include
signature tampering, stale/wrong-channel documents, absent carried bytes,
duplicate/oversized graphs, unknown legacy state, optional deadlines and a
red deployed-byte gate that forbids alias movement. No game-wire changes.
