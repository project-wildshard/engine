# Engine pins shard-format v0.4.8

> Written by: Claude (opus-engpin048), 2026-11-13

Engine's `@wildshard/format` moves from `shard-format#v0.4.7` (`adca9dd`) to `#v0.4.8` (`629b944`, tag object
`d3827a8`). v0.4.8 carries the AU5 gap fix (`febce6b`): every audio file under `/assets/music` or `/assets/sfx`
counts toward a shard's audio budget, a file's format is read from its bytes rather than its name, and a new red code,
`audio-container`, refuses FLAC, AIFF, Ogg, MP3, WebM, CAF or unknown audio. It also carries SA41's test fix (`d5ee169`).
No player sees a change, and no engine source changes.

Engine admits products with `validateShardfileProduct`, which only measures audio; the red budget refuses at
api-server's upload, not in engine. A full `pnpm pins` under v0.4.8 admits all 27 pinned products, and the cook,
pin, audio, format and grid tests pass. Run against the same products, the AU5 report is unchanged from v0.4.7:
no pinned file is an `audio-container` refusal, Nalati is AMBER at 8.66 MB, and Pine's pinned product is red at
14.66 MB (38 recordings, its old folk and orchestral sets among them) on both versions. Pine's source dropped those
in `d79af39`; a Pine pin from that source should bring it under the line. `DRAWN_GRID_RADIUS` and the ring-3 handling
are untouched.

The two wire lock rows gained `gitHosted` again on install and are restored by hand (WR2,
`test/wire-lockfile.test.ts`).
