# Share the local staging build

`node scripts/memory/iphone/serve-local.mjs --public` starts two
Cloudflare quick tunnels and prints the page URL after the public
release and game door agree on the build. It defaults to page port
4442 and socket port 4452 so the tailnet run can keep its ports. Stop
the launcher with Ctrl-C to close both tunnels and the dev world.

Public mode uses in-memory saves and the reviewed staging snapshot
for the client and server. The game door omits the local dev-control
route. The local build reports the staging grid strip byte overage
(4,817,545 versus 4,588,000). Release builds enforce the same cap.
