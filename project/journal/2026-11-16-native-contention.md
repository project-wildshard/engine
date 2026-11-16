# Admit cold native suites before their clocks

> Written by: Codex
> State: locally qualified, 2026-11-16; paired gate and hosted proof pending.

EV6/DS4's loaded gate timed out in the original ten-second setup of
net-fuzz and the Nalati/shards physics files. All three were native
two-slot workloads, so they could start beside other admitted work.

The real broker regression first fails because net-fuzz starts while
a partial holder owns one slot. It now queues before collection, then
the original three suites run unchanged after release. The private
three-slot ledger gives small hosted runners the same counterexample;
an actual outer all-slots grant accounts for all child CPU work.
The regression checks cleanup and keeps per-file original run logs.

Add these files to the existing exclusive policy. Ordinary split gates
already send that policy to hosted CI; complete gates reserve all slots
before collection and preserve all case deadlines and assertions.
The regression itself reserves the outer budget before nested work.

Local proof: the three actual original suites pass after queuing;
the installed Vitest wrapper and both existing broker cancellation
controls pass (three cases, 43.11 seconds). Game lint and full types pass.
The new tree needed normal gen:inputs before Rapier was available.
No scheduler/provider implementation, quarantine or test limit changes.

The historical snapshot ENOENT is a separate DS4 qualification: its
actual log names a package-less glob-cache fixture. Main already has
0558251e9, which retains package-less roots; qualify that existing fix.
