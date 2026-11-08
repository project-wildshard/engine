# Refuse one player while the cell keeps running

The hello decoder already catches unexpected hook throws. The real red
boundary was a rejected hello retaining a seat and posting seated after
its socket closed. Let identified explicitly decline a binding, then
retire the rejected seat without a checkpoint or a false acknowledgement.
Room handoff uses the same admission result.

A seated player's lost reward identity also reproduced the review's
tick failure: the real profile adapter returned false and Creature
rewards could not be saved escaped the tick. Multi-player reward owners
can now report a refusal for the simulation seat. E7 queues that seat's
retirement until the operation finishes, so other contributors and
clients continue. The refused reward cache is forgotten, no checkpoint
is emitted for it, identities and ledgers are cleared, and a fresh client
can reuse the seat. Unexpected exceptions retain the existing fatal path.

Both pinned Pine byte-boundary tests were red, then green. The focused
room, input, reward and refusal run passes 24 tests in four files in
5.31 seconds; typechecking and lint pass. This is follow-up on A3, held
until the integrator publishes SR1–SR8 and the loading repairs. The final
base still needs its recomputed schema hash, dedicated and deploy proofs,
matching server/phone builds, and the normal complete push hook.
