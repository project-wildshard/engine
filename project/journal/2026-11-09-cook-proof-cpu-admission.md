# Reserve the uncapped encoder proof's real budget

The existing cook-cpu-limit file runs eight actual q11 encodes in three
branches, including the deliberately uncapped no-grant branch. Its
worker-count and exact-byte assertions are useful: changing that branch
to inherit a pretend cap would weaken the proof. An outer Vitest worker
does not bound its actual native children.

The real outside-hook cook-admission-proof command first passes all three
original cases in 1.24 s, then fails its observed scheduler-grant assertion:
this file owns only one CPU slot. The CPU classification was missing it.
It now reserves all managed slots before collection, like cook-worker and
net-bots. The same command passes all three cases in 1.32 s / 2.05 s total;
197 actual scheduler observations show the full available grant. No test
body, encoder implementation, inner worker count or deadline changes.

Remote CI has no local broker, so a separate native-cook-cpu singleton
also keeps this file out of the two-worker ordinary phase. This preserves
every file and case and does not serialize unrelated native groups.

That move exposes a conservative sixty-second unknown weight to the
native phase. Use existing actual green Linux module receipts, including
collection/setup, rather than inventing a duration: exact 32f182d full
CI42703311246 shard6 ordinary reports 4824.455306 ms; separate Ring 1
42703311121 artifact13711789837 shard1 ordinary reports 4946.377766 ms.
Both retain all three cases. Per-file provenance accompanies the entries;
all other unknowns, factor1.35/setup70s, 90% gain, 240 s headroom and the
60 s file / 300 s shard limits remain unchanged.

This fixes test admission, not the production cook worker's native grant
contract. Pinefix2 owns that production handoff. No whole-suite saving is
credited: the three-minute full pre-push target and HS8 census stay open.
The new proof is explicit/manual, outside hook discovery, and finishes
under ten seconds when admitted. Normal full publication remains required.
