# 2026-11-18: a spawn row's `when` (ONE-FORMAT OF29a)

opus-of-m7c. A declared spawn row with `when` (format OF28c) stands only while its condition holds; otherwise its body
is absent: `hidden`, not alive, at y = -1e4 as a hidden native body is, so no brain, blow, death credit or loot touches
it, and `dataRespawn` leaves it alone. `quest`: any player in the cell at or past that step index; `time`: dusk and
night are night, on the host's day (`hostDay`: its clock, else the `world/days` row the climate installed); `wave`: N
opens once every body of N-1 has fallen, and stays open. Absent ids and opened waves are one adapter
(`data.spawn-when`); a shard with no `when` installs none. `test/declared-spawn-when.test.ts`, 4 cases.
