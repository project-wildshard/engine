# Another clone's install no longer moves the push proof

buddy-engine, 2026-11-21, for the Coordinator (opus-format-prune's
refusal).

opus-format-prune's push of 324e55a6f ran the gate green twice and was
refused both times with "Installed inputs changed during the gate". It
went through on J381 `SKIP_CHECK=1`. The gate fingerprints the installed
bytes before and after it runs (`scripts/push-dependencies.mjs`), and
they differed.

I traced the fingerprint one input at a time, then ran `pnpm install` in
a second clone. Seventeen inputs moved, and no package byte was among
them. Every one was a `.bin` shim inside pnpm's global virtual store,
for example
`links/@/vite/8.3.0/<hash>/node_modules/vite/node_modules/.bin/esbuild`.
All checkouts share those shims. Each install rewrites the shim's
NODE_PATH to name its own checkout's hoisted
`node_modules/.pnpm/node_modules`, so the shim names whichever clone
installed last. Any lane installing anywhere on the machine during a
gate refused the push. With the load at 25 to 37, that happens.

The fingerprint already wrote this checkout's own path as `<checkout>`.
It now writes any checkout's hoisted directory that way
(`shimIdentity`). The shim's target and the rest of its bytes still
bind, and the new test changes the target to prove it. Before the fix,
the new test fails on the second install.

One slip on the way: to flip the shims back I ran
`pnpm install --force`, which linked four workerd platform packages
(darwin-64, linux-64, linux-arm64, windows-64) into the shared store
without installing them. Those dangling links make every checkout's
fingerprint null. The gates still pass, but no proof is reused until the
links are gone, and the guard hook won't let an agent remove them. Never
use `--force` against the shared store.
