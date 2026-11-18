# Ship the Node author server with engine

An engine npm install does not recreate the checkout's pnpm patches.
Compiling the dev server from that install failed on missing format
exports. Build it under the frozen engine install and ship the result
with its worker, physics wasm and migrations. Sharddev copies those
bytes when it packs the dev package.

The authored server opens the verified build folder as one loopback cell.
Bring in the declared rigs its spawned creatures need for native height
and hit volumes. The authored world does not require a grid or road pack.
