# The slow card: a stuck load is never silent (QA 11-19 row 17)

> Written by: Claude (opus-tr4b7), 2026-11-19

Jake, ~12:18 Cancún, on a zone entry that sat at LOAD 0 %: "I have no idea what the waiting state is about ... There's no
like error model of worst case here." Before this, a load that stopped moving said nothing for 60 s, then opened the
fatal card.

Now each step has its own deadline (`stuckStep.ts` `slowStepMs`: 20 s, 30 s for shaders, the first frames and the
server seat). Past it with no progress, the start's watch sends a non-fatal report (`boot.slow`, with the stall context:
card step, rows, files, bytes, open operations and named waits) and puts a strip on the loading card (`ui/slowLoad.ts`):
what it is stuck on and for how long, a connection check (offline, the page's own `version.json` answering in N ms, slow
past 1.5 s, an error status, or no answer in 5 s), RETRY (a reload into the same place, `markReload`) and EXIT TO TITLE.
The strip goes when the card moves again; a second stretch of no progress shows it again. The fatal card still follows
at the 60 s bound.
