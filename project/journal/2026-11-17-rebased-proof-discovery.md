# Keep an authenticated full proof across land restarts

FL5b kept its basis only inside a running land invocation. After a manual
rebase or restart, the hook had no way to find the completed full gate.
FL9 treats the plan branch's last 64 reflog heads as candidates, then checks
each actual receipt with the current runtime, dependencies, pins and scope.
The existing disjoint-path and byte-identical replay checks still decide
whether the incoming main delta may select affected tests.

Land passes its observed incoming main separately from the proof hint. The
hook uses the same discovery for admission and final proof publication, and
retains the original full proof's lineage across repeated main races.
Changed harness inputs still select a full gate. Unavailable history or a
missing, partial, composed, changed-runtime or altered-branch basis never
substitutes for an authenticated directly completed proof.

The real Git regression failed before discovery existed. The 21-case proof
cohort passes. A native linked-worktree land completes a fixture full gate,
loses a remote refusal, rebases separately, then authenticates that earlier
proof on the restarted land. Lint and types pass.
