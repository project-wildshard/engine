# Publish the engine test candidates

Status: done 2026-11-08: engine and seven source cleanups published.

The 283 decisions in `test/engine-lift-disposition.json` resolve as
43 migrated files and 240 J186 removals. Engine-only 9059d6ba175e
contains their reviewed gameplay successors. Its whole normal
pre-push passed in 877 seconds after v0.1.1 was observed. The Ring 1
Pine catalogue path repair is included in the integrated engine
publication 8278424e46ef, whose whole pre-push passed in 821.9 seconds.

Every source cleanup ran on current main in a fresh cache clone,
preserving the incoming runner build workflow and A2 receipt. Its
original cleanup receipt is retained as A3. Every final pending list
is empty, every normal publication gate passed with zero findings,
and SSH keepalives were enabled. Each final CI passed before the next
repository began. No deploy or hook bypass was performed.

| Repository | Migrated / deleted | Final main | Successful final CI |
| --- | --- | --- | --- |
| Dunes | 5 / 2 | 5c21e657b5f3 | [42444418924](https://github.com/project-wildshard/shard-dunes/actions/runs/42444418924) |
| Sky | 1 / 9 | 677af030ebbc | [42445213173](https://github.com/project-wildshard/shard-sky-reach/actions/runs/42445213173) |
| Driftwood | 8 / 59 | 9dd8f13f85fe | [42445620410](https://github.com/project-wildshard/shard-driftwood/actions/runs/42445620410) |
| Nine | 3 / 20 | 317da8825c4e | [42445867661](https://github.com/project-wildshard/shard-nine-dragon/actions/runs/42445867661) |
| Pine | 16 / 48 | 637f0385eae4 | [42446207850](https://github.com/project-wildshard/shard-pine-hollow/actions/runs/42446207850) |
| Nalati | 9 / 99 | af4cd8b9cece | [42446495142](https://github.com/project-wildshard/shard-nalati/actions/runs/42446495142) |
| Open Plots | 1 / 3 | e4c07dc8e62d | [42446939629](https://github.com/project-wildshard/shard-open-plots/actions/runs/42446939629) |

Nalati carries the corrected held-weapon-laws judgment: nine pure
scalar law cases and one fabricated binding case, rather than a
file-wide mock-count reason. The actual mounted lance successor
checks cone and rehit. Open Plots retains every real product bake
and assertion, with one ten-second case per product rather than a
single catalogue-wide 300-second allowance. All eighteen local
bakes pass at 0.595–3.075 seconds each; final CI also passes.

The external ENGINE-TESTS-REPORT and TESTDEBT-REPORT contain exact
hashes, counts, gate results and CI links. This lane's original
engine clone retains the open S1/process-loss and death-order rows
in the split-combat repair plan; they are separate from this closed
publication queue. Its new SR work is handed to codex-port for
publication, never pushed separately by this lane.
