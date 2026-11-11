# Dedicated server

E7 uses `src/server/host/dedicated` for the WebSocket gateway, cell
workers, PostgreSQL player saves and signed release admission.
`src/client/host/online` connects the page to that world. Shared release
rows live in `src/shared/host/releaseRows.ts`.

Build with `node scripts/build-server.mjs --build <id> --out <directory>`.
Add `--tar <archive>` to emit a release bundle. The directory contains
`main.mjs`, `cellWorker.mjs`, `rapier.wasm` and SQL migrations. A signed
release names the build, channel, shards and bundle hash. Its save epoch
must be at least 1: epoch 0 belongs to the pre-engine saves (J190).

Every seated player has their own `PlayerStore`. The PlayerDoc carries
inventory, purse, gear, quest progress and creature reward profiles.
Reward keys are schema-validated on admission. A room binds reward
identity to its verified seat, and clears the binding when either an
added player leaves or the retained lead seat is emptied.

The door claims each player's Name with a four-digit tag before it
seats them (`saves/names.ts`, MMO-PLAN MP2.4), so everyone reads
`Name#1234`; a Name with a listed word reads as Guest. A `room` chat
line is the world's: its cell cleans and flood-checks it, and the door
relays it to every other awake cell (MP4.1). Proximity stays in its cell.

`test/dedicated-*.test.ts` exercises the gateway, rooms, saves and
release boundary. `scripts/room-deploy.mjs` is a local proof: two bots,
a rejected hash, restart onto the retained release, a valid bundle
change, telemetry and a reported worker crash. It requires two bundles,
a pack origin, its own work directory, the bundled deploy bot and a
local PostgreSQL URL. It opens only loopback listeners.

The `scripts/online-*-proof.mjs` tools preserve E7-PHONES's manual
browser and phone proofs. They require built pages and booted devices.
Their presence does not establish physical-phone or VPS proof. The
scripts under `scripts/vps` are operational inputs for a later sitting;
porting them does not deploy anything.

Jake owns the [VPS setup and private backup steps](vps-setup.md).
The private `wildshard-backups` bucket and its scoped S3 token must be
created before claiming an offsite backup. No source change creates them.
E7 retains the current wire format; J197 wire v1 is separate.
