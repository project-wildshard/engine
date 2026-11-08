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

The complete layered compiler and focused script lint pass in an ordinary
frozen clone, including an explicit string-array type for requested commit
identities in the proof. Both actual CLI proofs pass there. J196's ignored
live aliases are left intact. Generate this conservative renderer stamp
from committed source in that clean clone so Pine's uncommitted channel
candidate is neither copied into the stamp nor touched. Refreshed timing
JSON and journals do not enter the renderer input set. The normal queue
still installs and proves the actual rebased tree before any publication.
