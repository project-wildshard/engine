# The push gate runs tests that read a changed file by URL

Main red 45746379191 (and 45744424023), opus-fr13. My 90714b4e3 (QA 11-25 row 72) routed finish.ts's
after-boot audio through an observer; finish-background-idle.test.ts runs finish.ts's afterControl block
from its source text, and its sandbox had no `afterBootAudio`, so it threw a ReferenceError. The push
gate never ran it: Vitest's related selection follows imports, and a test that reads source by
`new URL('finish.ts', import.meta.url)` has no import edge. The test now passes the real observer and
asserts the audio starts pending at control. The guard: push-path-edges.mjs `urlReaderTests` finds
every test that reads a changed file by `new URL(..., import.meta.url)` and fs27Plan adds it to the
push, so no such reader needs a hand row in PATH_EDGES again.
