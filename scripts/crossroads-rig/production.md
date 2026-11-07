# Production memory check (SF22c, E435)

Pause ▸ Settings ▸ Debug ▸ Memory check ▸ Run opens `/crossroads-rig/` in the same tab. One tap runs three checks,
disposes each renderer, posts each result and a summary, then offers Return to game. This static page is emitted by
`scripts/app-build/crossroadsRig.ts` in every production web build. It has no configuration controls or URL switches. The separate
SF22a developer tool retains its configurable entry.

`crossroadsConfig()` in `src/format/contentBounds.ts` supplies the fixed caps-v1 configuration to both the page and the API validator:
29 L0 tiles (21 resident plus 8 lookahead), 32 L1 tiles, 9 far proxies, 4 libraries and 4 simulations; render scale 2,
80 m shadow radius. Production L0 control maps are 256², L1 maps are 512/256/256 and far terrain has 62 segments, keeping these units within
the provisional 2 MB and 8,000-triangle caps. Two temporary L0 tiles churn during the measurement. The API loads the same config through relative emitted JavaScript, so its cold start does not depend on workspace TypeScript exports.

The anonymous `/api/telemetry` records contain the build, run/series/iteration, stage, fixed configuration, device
context, accounted GPU/CPU bytes, per-phase cadence and CPU work p95, context loss, errors and Safari's null JS heap.
These bytes account for synthetic content and exclude the engine's base allocations. They are not an OS footprint.
The existing private Blob store and thirty-day retention apply. Completed writes are acknowledged; failed results
queue locally and retry automatically when the game boots or goes online. Authenticated readers use
`GET /api/telemetry?rig=crossroads` with the existing `x-review-password` header. Rig records do not enter session
crash-rate calculations.

Run `node scripts/crossroads-rig/production-probe.mjs --rev=HEAD` to verify the actual Debug action on a clean pinned
build in Simulator Safari. It owns a preview, HTTP proxy, Inspector proxy and dedicated Simulator lane, and cleans
them up. The real pinned production POST/GET handlers persist into a local fixture Blob backend; the JSON artifact
explicitly distinguishes this delivery proof from deployed telemetry and physical-device evidence.

SF22c's physical freeze criterion is three completed runs on the physical iPhone at caps v1 with no tab kill or
context loss, recorded automatically from one Debug tap. Simulator completion does not freeze SHARDFILE_VERSION;
the format stays at version 0 until the physical record exists.
