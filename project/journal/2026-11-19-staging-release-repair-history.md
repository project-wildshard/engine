# A browser proof repair keeps the staging cut

Staging v0.1.52 was dropped before tagging. The signer compared its
history to v0.1.53 and refused the newer build because the v0.1.53
Explore test repair sits after its version and changelog stamp.

Recognize a single follow-up confined to browser tests and its journal.
Keep the published branch, version, original main cut and forward-order
checks. Runtime or dependency changes still need real ancestry, and
production keeps its ancestry rule. The signer runs this check from
main so the exact green release build can stay pinned.
