# Use the committed mirror inventory for renderer identity

The real pinned-HEAD preview reached all 28 pins and then failed.
Its exported tree intentionally has no Git discovery capability.
Renderer stamping still asked Git for tracked inputs there.

Reuse the existing root-bound committedSourceFiles capability instead.
An ordinary checkout reads HEAD; a mirror checks its exact inventory.
A crossed root refuses instead of discovering an unrelated parent repo.
The separate installed-package stamp path remains unchanged.

Six explicit renderer proofs pass in under one second.
The new case hashes a Gitless exported fixture and rejects a crossed root.
This repairs preview generation, without changing rendering code.
