# Retire the temporary staging socket fallback

> Written by: Codex
> State: implemented, 2026-11-16 (MMO-SERVER MS7.3).

The signed staging release93 and matching health name rooms-staging.
The fallback to the old Funnel WebSocket was intended for one release;
it is still accepted by the bot and three browser proof drivers.
Remove it from those allowlists and the actual bot target predicate.
Preserve private HTTPS health reads on the tailnet (D7), loopback
replicas, the staging Origin, address checks and four-socket limit.

Regression checks drive the real target predicate: rooms-staging and
loopback pass; both old Funnel ports and production refuse. The guard
also checks all four driver sources before any bot is constructed.
This changes no server configuration or public endpoint. J373 leaves
the ordinary staged multiplayer/release witness in final row MS9.

Review NO MUST; its first SHOULD caught NL3's intentional --tailnet
diagnostic sharing the old public list. Preserve that explicit private
route separately: public signed releases must name rooms-staging, even
for a private diagnostic. Only the CLI flag passes privateControl to
the copied bot guard, which requires the exact private origin/path,
no query/hash, own-address mode and the same four-seat limit. Unknown
routes refuse before a socket. The report keeps addresses unchanged
and adds route. Other proof drivers have no private socket fallback.
Twelve functional guards, types and game lint pass. Final delta review
also has no MUST. Positive Origin/CORS/health behavior remains in the
real drivers; the source rails assert retired-host exclusion only.

The complete staging driver then passed twice against signed serial93,
build a1adf711: two bots for five seconds on the ordinary public route,
and separately with explicit --tailnet. Both seated, stayed, walked,
saw one another and left; neither dropped a frame. Each run verified
signed-release/health identity before building and before first hello.
The public route never selected the private socket implicitly. These
short functional proofs do not qualify the timed network benchmarks or
the staged release/rollout witness in MS9.
