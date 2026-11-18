# Reverting the boot-time phone geometry retire (ad52cc05)

Main run 44306822172 (b33ab4bb..ad52cc05) reddened memory-ledger-guard
on Pine Hollow: control loading read 127,151,812 B on both boots,
against a 120,801,079 B line. The guard's retry, added earlier today,
read the zone twice and both boots matched to the byte, so this was
not sampling noise.

Pine's hosted array-buffer reading had been exactly 115.98 MB on every
main run from b786cd2b to b33ab4bb. On ad52cc05 it read 124.69 MB, while
geometry-cpu fell from 6.84 to 0.16 MB. Net page RAM grew 2 MB, and
6.7 MB moved out of geometry into loading. ad52cc05 is the only commit
in the range that touches geometry. 1ec827b8 only returns ledger loans
earlier, and 1dcec367 is script-only.

On my Mac (Chromium Metal) the change does what its commit message
says. geometry-cpu drops 6.6 MB and array-buffer is no higher, but
local Pine array-buffer swings by 50 MB from one boot to the next, so
the Mac can't settle the hosted case. Something on hosted SwiftShader
allocates about 8.7 MB of plain buffers once the batches retire at
boot. One candidate is the BatchedMesh clone during shader warm-up,
which the removed skip used to guard. I could not pin it down within
J249's 20 minutes, so I reverted the code and tests and kept
codex-memgates' journal entry. The NOTE to codex-memgates carries the
numbers so the change can land again with the hosted path covered.
