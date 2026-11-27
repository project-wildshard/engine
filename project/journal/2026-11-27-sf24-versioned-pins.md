# SF24: every pin the zone table reads names its shard version

codex-cookkeys' SF14 proof found staging's zone table 404ing: `ownZoneTable`
(page-release/zone-table.mjs) builds a table only when every pinned zone
names a shard version, and seven pins on main had none.

- Brasscap 19 and Glowfen 8 re-pin the same uploads from staging, which now
  names their versions (0.5.21, 0.0.8). Mirror Salt moves 7 to 8 (0.0.8) and
  Mossgate 25 to 27 (0.1.23, the SDK template at sharddev 2f4051fa31): the
  uploads staging already plays.
- Desert Ruin and Thin Ice are hidden on staging, so the staging channel
  omits them and pin-shard refused them. Their versioned uploads (0.0.4, as
  uploads 4 and 5) live on preview, the channel engine's pins are. pin-shard
  takes `preview` now, for a slug staging names nowhere only: a zone
  staging plays still pins staging's upload (`pinnedRow`).
- Pine is the last unversioned pin; it follows its images-only upload.

Proof: 107 test files that read these zones or the pin files pass on the new
pins (841 tests), public-verdicts too; `ownZoneTable` on the new catalogue
misses only pine-hollow. All 27 pins are on the mirror. Guards: the
`pinnedRow` test, and a test that lists the unversioned pins (Pine only).
