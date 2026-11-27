# A timed-out cook that kept encodes goes again (SF21)

Lane opus-public, meta standalone shardfiles SF21 (coordinator,
2026-11-27). Production's cook box has fewer cores than the MacBook, so a
big zone's first cold images-only cook (Pine) will run out of the 1500 s
clock there too, maybe more than once. A cook that ran out of its clock
used to be final.

Now a timed-out try that kept new texture encodes is tried again,
up to `PROGRESS_TRIES` (4) more times. Every try under a worker's
jobs folder shares `cache/encodes` (`encodeFolder`), so each retry starts
from what the last one kept and the cook finishes once enough is cached.
A try that kept nothing new is still final, and so is every other final
failure. `test/cook-progress-retry.test.ts` runs a fake slow encoder
through the real bounded child. It shows that a first try times out and
the retry finishes from its kept encode, and that a run which keeps
progressing but never finishes stops after the bound.
