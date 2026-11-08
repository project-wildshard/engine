# Prove the named shard deadline on the runner

The published rebalance f7fdc25 passes exact CI 42497139602: seven actual
job walls are 171, 193, 139, 210, 158, 207 and 217 seconds. Every shard
has more than the requested twenty percent of its five-minute budget
left. The membership and sixty-second file gates remain unchanged.

The existing outside-hook deadline proof now also runs in the hosted
planning job. Its real child exceeds a reduced 600 ms proof limit and
returns CI_SHARD_BUDGET_EXCEEDED, drains a detached descendant, preserves
success and the original nonzero child status. It never raises the real
300,000 ms acceptance limit. Local receipt is 620 ms; retain a hosted
receipt rather than infer Linux process cleanup from the Mac proof.

No tagged workflow was rerun. Five distinct green matrices and the
quarantine owners' ten-run qualification remain separate open proofs.
