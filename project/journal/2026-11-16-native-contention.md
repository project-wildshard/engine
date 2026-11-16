# Admit cold native suites before their clocks

> Written by: Codex
> State: locally qualified, 2026-11-16; paired gate and hosted proof pending.

EV6/DS4's loaded gate timed out in the original ten-second setup of
net-fuzz and the Nalati/shards physics files. All three were native
two-slot workloads, so they could start beside other admitted work.

The real broker regression first fails because net-fuzz starts while
a partial holder owns one slot. It now queues before collection, then
the original three suites run unchanged after release. The private
ledger uses the real machine capacity. On machines with at most two
slots, the old two-slot native request was already effectively
exclusive; the red partial-holder distinction requires more than two.
An actual outer all-slots grant accounts for child work locally.
The regression checks cleanup and keeps per-file original run logs.

Add these files to the existing exclusive policy. Ordinary split gates
already send that policy to hosted CI; complete gates reserve all slots
before collection and preserve all case deadlines and assertions.
The three regression files each run one original suite and have their
own native no-sibling hosted unit. Hosted siblings do not participate
in the local CPU ledger; native placement provides their isolation.
They require full products and are explicitly Ring 2. Keeping each
suite in a separate file retains the existing file timing budgets.

Local proof: the three actual original suites pass after queuing;
the installed Vitest wrapper and both existing broker cancellation
controls pass (three cases, 43.11 seconds). Game lint and full types pass.
The new tree needed normal gen:inputs before Rapier was available.
Scheduler/provider implementation and quarantine stay unchanged, as do
all original test limits.

The one review found the initial hardcoded three-slot private budget
was invalid on small hosted runners and ordinary hosted placement
would make the combined proof compete and exceed the file budget.
Both are corrected above. Async fixture ownership now TERM-drains
the actual proof group and keeps a bounded hard fallback; proof signal
handling drains children and logs while running. Cleanup preserves the
primary error and releases the outer grant even if broker close fails.

Cost: the initial three-original-suite proof took 42.32 seconds locally;
it repeats those suites, and exclusive originals also lose parallel
overlap. The corrected complete paired gate will measure that cost;
no gate-speed improvement is claimed. The initial full gate was
intentionally stopped for review corrections, not a qualified pass.
Its simultaneous ordinary split gate passed 138 cases in 126.1 seconds.
After correction, all seven cases in five files pass in 47.22 seconds;
the three separate native proofs take 14.52, 12.99 and 14.38 seconds.
The real cancellation control sends TERM after collection and verifies
the recorded worker stops and the private ledger drains. Lint and full
types qualify the corrected source before the paired gate is repeated.

The historical snapshot ENOENT is a separate DS4 qualification: its
actual log names a package-less glob-cache fixture. Main already has
0558251e9, which retains package-less roots; qualify that existing fix.
