# Agent markers for engine network probes
> State: implemented, 2026-11-19.
> Written by: Codex

METRICS MT3 starts with the Node preload for HTTP and WebSocket.
It marks the game services and proof rigs on loopback, and keeps
caller headers, protocols and query parameters. Staging smoke,
live status and the MMO bot driver use it. The bot driver also
puts the marker in the address it passes to older signed-release
runners. Current bot bundles add the marker to their handshake.
Downstream tooling and broader entry-point coverage remain in MT3.

Engine operator reads now mark hosted fetches without changing global
transports. The ready-to-run preload still marks HTTP and socket traffic
for the bot entry points. CI checks operator scripts and workflows for
raw hosted requests and browser-wide marker headers. Shell probes send
the UA marker, and WebKit's game navigation carries the query marker.
