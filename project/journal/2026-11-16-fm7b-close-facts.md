# Optional close facts preserve legacy behavior

FM7b1 uses only the existing 123-byte WebSocket close reason, with a versioned
reason code and bounded optional numbers. Full (4002) may name a real queue
position/known ETA; refused (4001) may name a terminal auth/ban/refusal code.
Absent numbers stay unknown, no English UI strings travel, and unknown,
malformed, mismatched or oversized metadata falls back to the existing close
code. There is no new binary prefix, layout, voice/playtest overload or game
schema hash. Server emission takes an explicit optional argument; it does not
invent account or moderation authority. Live save/queue updates still require
the wire owner's compatible-carrier agreement (FM7b2/3).

The native loopback proof runs the actual server and browser transports using
Node's WebSocket: old client/new server keeps full=4002, new client/old server
gets full with no facts, and new/new sees validated facts. Unknown versions
stay generic. Twenty-one focused socket and wire tests pass, including the
frozen frame/lockfile cases. No new backend auth or queue is claimed here.
