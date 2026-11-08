# Restore logical checkpoints without a wire round trip

The quarantine investigation found object snapshots serialized and immediately
decoded before installing their fresh native world. No bytes cross a process
boundary there. Transport work contributed to the ten-second combat cases.

The codec lane supplied strict admitSimSnapshotBytes in ff43d22.
This change integrates that API at both actual headless resident callers.
Strings still use the strict wire decoder, now directly into detached bytes.
Legacy logical arrays and native typed physics use the same strict admission.
Installation still recreates the full roster before restoring the world.
Registration, identity, ownership, malformed-state and effect fences remain.

Native installer consumers read snapshot metadata, not physics.
Their parameter types now say that, instead of demanding boxed arrays.
The deferred keeper needs only adapters, so its input says that exactly.
No physics or codec implementation is changed by this caller integration.
The codec lane retains ownership of those paths and performance work.

The unchanged five-file save/play baseline passes 28 cases, zero skipped.
Engine-rule successors takes 32.053 seconds before and 17.169 after.
Awareness takes 23.629 before and 23.376 after.
Discovery takes 25.595 before and 24.816 after.
Field taming takes 20.424 before and 20.522 after.
Pinned restore takes 9.906 before and 10.053 after.
This demonstrates the object-heavy engine-rule gain, not a universal gain.
Both runs use one outer worker and original workloads and deadlines.

A manual real Nalati caller proof exercises 22,117,708 native bytes.
It checks detached ownership, numeric bits and eight matching strict refusals.
The actual caller also rejects duplicate flags and an uninstalled adapter.
Twenty full future snapshots agree across independently restored worlds.
The typed caller uses no compatibility array bridge; total is 5.999 seconds.
Existing active native-decode/cache proofs pass 22 cases, zero skipped.
The requested byte-capture/roster files remain lift-pending, not credited.
Full layered pnpm typecheck and focused root-config lint pass.

No quarantine entry or deadline changes. Hosted ten-run qualification remains
pending, including whole-file budgets and complete ci/ring-1 verdicts.
The rejected scalar bank cache showed no repeatable whole-proof gain and was
removed. Nothing reduces ticks, actors, rounds or independent replay coverage.
