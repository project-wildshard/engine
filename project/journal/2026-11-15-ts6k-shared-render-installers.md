# Share render suites with local installers

> Written by: Codex

> **State:** built locally, 2026-11-15; HOW-WE-BUILD TS6k.

Five existing suites now share a Node worker: allocation-journal,
compressed-mipmaps, uniform-vector-buffer, uniform-scalar-buffer and
uniform-caches. Their 28 original cases and deadlines remain unchanged.

The allocation journal wraps only its owned fake context and receives its
own memory ledger. Its stop restores context methods, deletes the WeakMap
entry and disposes the owned page-scope child. Mipmap registries are weak
collections keyed by owned textures; the tests dispose every texture.
Uniform installers wrap owned program arrays and uniform trees, with
per-uniform buffers. They never patch Three prototypes or module constants.

The source audit covers the tests and actual installer implementations.
All cases pass individually and in exact forward/reverse shared orders,
with an extra resource-scope census balance assertion after every suite
in the meta measurement harness (not an installed shared-project guard).
One worker and identical production setup/aliases: warm isolation 2.420
CPU-s; shared forward/reverse 1.813/1.781 CPU-s (full child-process CPU via
RUSAGE_CHILDREN). These are local observations, not a full-gate saving.

The candidate was measured while the previous speed branch landed, with
that branch unchanged. This new branch starts from current main; all eight
audited test/implementation source hashes match the measured candidate.
Evidence is in meta `docs/plans/vitest-bench/`.

Save-epoch/page-save/server-export suites stay isolated: their SaveStore
definitions enter a module-wide registry, so identity/environment cleanup
alone would not establish independent shared execution.

J206 land review: NO MUST. The allocation-journal case now calls stop in
a finally block, so even a failing assertion releases its owned scope
and context wrappers before the shared worker runs another suite.
