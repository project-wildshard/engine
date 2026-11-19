# Give Explore its own build

> Written by: Codex
> State: EX2, 2026-11-19 (J466, J467)

The Explore stamp boots the solo worker against the selected shard; the
worker keeps its documents in page memory. The viewer leaves the
creatures and NPCs running and keeps player input, pickups and practice
out of the session. It has its own service-worker caches and prepares just
the selected discovery, so returning offline doesn't need every shard.

`bash scripts/serve-build.sh --explore --shard driftwood-isle` serves
the build locally. The public staging release wiring is EX5 (J468).
