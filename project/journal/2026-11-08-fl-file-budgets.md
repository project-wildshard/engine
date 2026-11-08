# Reduce genuine work in the three newly quarantined files

J193 assigned the cook and two population file overruns after CI 42478017721
passed their assertions but measured 111,595 / 101,959 / 102,584 ms against
the 60-second file budget. Policy 7d4d03d gives all three the fixed deadline
2026-11-10T12:04:31Z. No entry or deadline is removed or changed here.

Driftwood's existing worker comparison ran 300 commands on each actual world,
but published a three-megabyte continuation every tick and asserted only the
final one. Use the existing bounded verbTapePart for the same 300 worker
commands, keep all 300 resident steps, tick=300, exact serialized snapshot
equality and all 34 bodies. The independent population/respawn/restore and
server-file isolation cases stay intact. The earlier audit measured 44.15 s
for the file; all three cases now pass in 7.61 s, worker comparison 2,851 ms.
Its case bound is tightened to ten seconds, not raised. Linux qualification
is still pending; this is not a claim of ten hosted passes.

The audit also found a production retry bug: publication throws a permanent
pack-budget refusal, but FINAL was checked only before the catch. Move that
same existing terminal classification after both return and catch. Transient
failures keep the unchanged three-try loop. A new assertion at the existing
public download boundary, using real product bytes and real child cooks,
reproduced red: three downloads instead of one, 29,039 ms. After the fix all
23 original cook cases pass, budget refusal 5,670 ms with one download and
no published index. Sandbox, hostile archive, HTTP, cache, memory and clock
proofs remain. The full contended file still takes 68.08 s, so its file-budget
work remains open; do not call it qualified or relax the 60-second gate.

Register cook and both population files once in the existing native-group
registry, preserving one outer worker after eventual promotion. Nalati's
actual raid delay, every real tick, census and restored equality remain
unchanged. Its measured native physics/group-step work needs further approved
optimization; no clock, actor or state is fabricated to fit a file budget.

Actual full discovery and planning validates all 1,144 files with each of the
eight affected paths native exactly once and ordinary zero times. Population
files stay independent scheduling units: bundling both into one atomic group
failed the existing five-minute planner floor; separate groups validate with
seven hypothetical post-promotion shards under the current timing table.
No duration table, case inventory or clock gate is changed to make that pass.

Qualification of a file-budget entry requires a real <=60-second whole-file
receipt, including preparation/imports, as well as its original passing cases
and ten green complete workflows. A passing assertion report alone cannot
prove that an overrun is repaired. Existing quarantine reporting currently
does not provide the full CI budget reporter receipt; that seam must be kept
with its infrastructure owner before any promotion claim.

These are prepared commits for codex-port's release lane, not a separate
engine upload. Normal full pre-push remains required for the published batch.
