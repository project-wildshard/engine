# Retain the real restore walk in the native cohort

CI 42475678403 on a7ed8e0 reproduced a ten-second timeout in the saved Nalati
walk. All 5,770 other blocking cases passed; the original four quarantine
files passed separately. J193 explicitly extends quarantine ownership to this
file; codex-port added the policy entry in 2d1f44f, with its unchanged fixed
deadline of 2026-11-10T11:57:31Z.

The audit already measured the eight-product proof: physics snapshot framing
and compression are material, and native Nalati opens both original and
restored worlds. The focused unchanged Nalati case passes locally in 3,152 ms
(5.64 s file run, one case passed/seven intentionally filtered). That warm Mac
result does not disprove the observed Linux timeout or establish its cause
as CPU starvation alone.

Register the existing file once in its own native-restores group. The incoming
CI planner gives native phases one outer worker, preserving the same setting
used for quarantine qualification after the file returns to blocking coverage.
No gameplay source, test body, timeout, command, saved checkpoint, suffix,
digest assertion or product is changed. This is a scheduling containment
candidate; only ten actual green ci and ring-1 executions can qualify removal.

All eight unchanged product cases pass with one outer worker in 12.18 s;
the slowest case is Nalati at 2,877 ms. The file total includes eight real
products; each individual case stays below ten seconds. Actual full Vitest
discovery plus the incoming planner validates 1,144 files/six shards, with
each of all five affected paths native exactly once and ordinary zero times.
This does not claim a fresh Linux pass for the added file or ten-run stability.

The first full ci qualification verdict remains red on this additional file;
the watcher stopped rerunning that source rather than masking it. The new
2d1f44f batch includes the existing four fixes and this added quarantine.
Further publication still follows the coordinator's production barrier.
