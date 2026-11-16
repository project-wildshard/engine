# Keep the CI contract while allowing the empty-quarantine guard

Bugfix2 CI43965502564 share4 failed the workflow contract after
4011aa29 added the intended nonempty-inventory guard to quarantine.
The test demanded that the docs guard come first after `if:`, rather
than checking that it remains part of the condition.

Require the same docs exclusion, allowing another conjunct before it.
Every reuse/packed-share assertion remains. No workflow or job gate is
changed; this repairs the stale test and leaves real failures blocking.
The separate freeze-drift failure is owned by buddy-engine, whose
6440b857 diagnostic commit is already in this shared queue.
