# 2026-11-19: failmode-proof --prepare builds a world on a laptop

Lane: buddy-engine (Coordinator, from opus-of-proofs).

`failmode-proof.mjs --prepare` built its laptop fixture through `serve-build.sh`, and since
9b2113fc2 every serve-build is a preview build (`--mode preview`). A preview never names a
world, so the fixture refused the loopback release and the proof could not start off a runner.

The hosted path already built it right: Ring 1's pins plus Driftwood's product, then
`build-app.mjs` in production mode. A laptop now runs that same command, straight into the
fixture's own `<work>/dist`, and then puts its tree back: the full pins and the generated
boot inputs, which Ring 1 alone would have left short (the three `*.generated.ts` files that
kept turning up dirty in engine-quickfix are this kind of leftover). On the Mac it builds in
27 s, and the worktree is clean afterwards.
