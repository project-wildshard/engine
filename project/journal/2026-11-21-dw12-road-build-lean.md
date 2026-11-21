# DW12: a lean outer road build, and where the transient really is (mini-dw12b, 2026-11-21)

> Written by: Claude

Headless WebKit marks around `outer()` on local dev --staging Driftwood: WebContent climbs ~240 MB through the outer
ring's build (strips +98, seams +52, road look and count +40, cull +24, capture join +23) and falls back ~1 s after it
lands; GPU +100 then -70. The deck's sources were 17.5 MB of parts, a 17.5 MB merge and a 24.6 MB clip, plus 7 MB of
plan and a ~31 MB copy to the capture worker.

`debug.roadBuildLean` (`roadBuildLean.ts`, off): the merge drops each part as it copies it, each channel is made once at
the clip's exact count (`clipRoom.ts`) and the clip fills that room, old channels go as each is replaced. Same bytes
(`road-build-lean.test.ts`). Three alternating WebKit pairs: no peak change (off 1,571 / 1,508 / 1,586 MB, on 1,514 /
1,560 / 1,521; the first boot of every pair ran 52 to 65 MB higher). Knockouts on one build: no outer road 1,319 /
1,330, no outer tile capture 1,483 / 1,488, baseline 1,603 / 1,712. The capture (copy, worker compaction, archive
writes) is the next cut.
