# Reuse verified Brotli parts in the hosted memory ledger

The hosted ledger's full build encoded 435 of 439 q11 spawn parts in 770.4 seconds. The Vite bundle took 2.67 seconds. The ledger job already restored immutable pin tarballs and rebuilt the encodings on every runner.

Give the full ledger a separate encoding cache, keyed by its pinned inputs, packaging source and Brotli codec. The build still decodes and hashes cached entries before using them. Save only encodings the successful client build emitted. The same memory readings and limits still decide the job's verdict.
