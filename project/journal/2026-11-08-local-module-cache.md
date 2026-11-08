# Reuse transforms without retaining an old public address

CI13's real cache boundary reproduces a stale root package import:
cold and warm runs pass at value one, then the same caller still reads
one after package.json retags its public import to value two. The old
resolution key covered layer manifests but omitted the root manifest.

Include root package, lock and workspace identity beside every layer's
exports. The unchanged real fixture must now follow the retag. Keep the
existing glob bail-out, isolated forks, setup and WASM lifetime flags.
Enable this transform cache for local runs as well as CI, so native proofs
can reuse transformed code without sharing executed module state.

The proof uses actual Vitest files and a persistent cache in its owned
scratch directory; it deletes every run after recording the outcome.
No pure allowlist or isolation relaxation is introduced. Full-suite
performance remains delegated to the heavy simulation owner; a small
cold/warm spot check does not replace the required full gate.

The real retag proof is red before the fix (expected two, received one),
then green: cold 264 ms, warm 158 ms, retag 210 ms. The three unchanged
Node proofs take 1.26 s on the first cached run and 438 ms warm; their
earlier uncached Node run was 1.19 s. These are spot checks, not claimed
full-suite savings. Typecheck, lint and actual workflow checks remain.
