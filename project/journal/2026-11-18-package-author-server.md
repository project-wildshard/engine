# Ship the Node author server with engine

An engine npm install does not recreate the checkout's pnpm patches.
Compiling the dev server from that install failed on missing format
exports. Build it under the frozen engine install and ship the result
with its worker, physics wasm and migrations. Sharddev copies those
bytes when it packs the dev package.

The full SDK CLI still imports engine source to compile author commands.
The npm package therefore bundles its own frozen format dependency too.
An installed tarball resolved the exact patched module; the package test
compares the shipped skeleton module with its frozen source byte for byte.
Meshoptimizer is an engine runtime dependency so the bundled format's
decoder import stays resolvable under pnpm's isolated npm tarball install.
The publisher stages regular files before packing the closure. Packing
pnpm's global store links in place emitted archive hardlinks that tar
refused to extract. The archive test now extracts the entire package.
The source patch travels with the engine so an SDK workspace can apply
the same bytes to its shared format dependency before typechecking.

The authored server opens the verified build folder as one loopback cell.
Bring in the declared rigs its spawned creatures need for native height
and hit volumes. The authored world does not require a grid or road pack.
