# The census proof waits for a whole ready.json

Main run 44291731549 failed `test/tooling/gate-census-observe.test.mjs`.
In `scripts/gate-census-proof.py`, `json.loads` threw on an empty
`ready.json`.

The fixture writes that file with a plain `writeFileSync`, which creates
the file and then fills it. The proof waited only for the file to exist,
so on a busy hosted runner it read the file in between.

The proof now waits until the file parses, through a small `parsed`
helper that returns nothing while the file is missing or only partly
written. The other waits in the proof either test only that a file
exists or check its size first, so they don't parse a half-written
file.
