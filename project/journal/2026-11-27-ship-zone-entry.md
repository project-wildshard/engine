# The ship proof script (SF14)

Lane opus-public, meta standalone shardfiles SF14, built ahead so
codex-cookkeys can run it the moment the re-packed zones pin.
`src/scripts/ship-zone-entry.mjs` reads a deployed page's
`zone-table.json` (staging by default). It enters every zone the table
names, or the ones `--zones` picks, from the cook on a headless desktop
and a 402x874 phone, with sound off. The run fails when a tier misses
gameplay or when the page's own origin answers zone art: a path naming a
zone, anything under `/shardfiles/`, or an art file that is neither on
SF1's engine list nor the build's runtime. Title art and the page shell
are the page's own.

It refuses a page with no zone table ("not zone-free yet"), which is
staging today. The entry loop is `zone-cook-entry.mjs`'s, proven locally
on SF5 to SF9. Requests carry the agent marker through the marked
Playwright and the `?agent=` carrier. `test/ship-zone-entry.test.ts`
fixes the verdict: what counts as zone art, the reads by origin, and the
table it reads.

A tier also needs at least one of its zone's reads answered by the cook
(`shards/<slug>/`), so a page can't pass by entering with nothing read
from the cook (codex-cookkeys' review).
