# Ship the native compiler configuration

> Written by: Codex
> **State:** built, 2026-11-16; archive/native checks pending.

Real Pine and Driftwood author builds from fixed SDK archives reach
the packed engine and fail before generation: src/tsconfig.json extends
kit/tsconfig.json, which the engine package file list omits. Source
checkouts carry that file and hid the missing package input.

Ship the exact existing compiler configuration and require it in the
normal npm tarball gate with every concrete bin/export. No compiler policy
or runtime code changes. The actual immutable package native repeat proof
will use a fresh engine archive, not a file added to an extracted package.
