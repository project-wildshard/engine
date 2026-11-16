# Real worker parity and retained failure seeds

TC33, codex-pins, 2026-11-15. Follows the TC29 source at d5378e0b.

The eight actual Darwin 240-tick witnesses at d5378e0b matched their
existing baselines. The exact-SHA Linux counterpart from green CI
43783323738 matched all eight chains, 240 ticks each. No golden was
rewritten. Both witnesses are retained in meta docs/plans/test-coverage/
evidence/tc33-d5378e0b/.

Seed 20261115 was retained after a deliberate production dropped-input
control in stepResident. Both actual worlds caught the loss: Dunes moved
0.84 m and Pine 0.08 m instead of the honest player's required 2 m. The
production source was restored byte-for-byte in a finally block before
the seed was added. This is a planted control, not a newly found live bug.

The committed seed is now an ordinary default input beside 20261108,
for both hostile-client play and section/blob corruption of the real
Template tar. Environment overrides retain exact single-seed replay.
The tests' public outcomes and process/time bounds are unchanged. No
refusal counters or internal state layout become a new oracle.

Restored replay passed all eight cases with both default seeds. TC33
remains open: real non-rendering WebKit worker versus Node parity has
not yet been implemented. Relay at the second compaction (lane brief).
