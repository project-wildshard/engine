# Rebase the captured request before checking it

Queue020checks all5818cases green535.2s, but E7 advances main while that
check runs. Its normal push refuses; no force or false publication. A new
request also used to refuse an already advanced main before checking.

The real bare-remote proof reproduces that second refusal. The service
now rebases only its immutable managed clone before dependency install,
retains requestedSha/requestedTree, records the actual derived sha/tree,
and runs the entire ordinary hook against that actual tree. Conflicts
still refuse. Source checkout dirt never enters the capture or rebase.

Four actual Git attempts prove two FIFO rebased publications preserving
independent upstream bytes, a red hook refusal and a changed-source
refusal naming its path. The original requested hashes stay auditable;
checked derived hashes are distinct.2.118seconds, every snapshot removed.
A fresh post-check fetch refuses a later upstream advance before trying
a stale push. An advanced tree never reuses its earlier result. Full gate,
normal Git hooks, frozen dependencies and SSH keepalives remain required.
