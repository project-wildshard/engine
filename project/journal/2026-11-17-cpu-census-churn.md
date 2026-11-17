# CPU admission ignores unrelated census churn

SA25a's retained full-gate report failed in `group_members` while reading a
process identity. Admission took fresh kernel identities for every same-user
process before asking whether it belonged to the authenticated private group.
An unrelated process exiting or changing identity could abort service admission
or prevent reclaim from progressing. This is distinct from a load threshold.

A deterministic injected census first reproduced the unreadable unrelated PID.
Filter every positive listed PID by PGID before the fresh identity read,
including members omitted from the first census identity map. Darwin
can list PID zero; it is a kernel sentinel, not a process identity.
Disappeared PIDs are ignored;
unreadable actual group members still refuse. The control mocks every signal
API and checks no signal occurs, even with Python optimization enabled.
Permission errors refuse and a PID that leaves the group is excluded. No production grant or timeout is relaxed.

After a red-first sentinel control, eight CPU cases across five files pass, including actual service completion,
helper loss, owner loss, borrowed commands and provider reclaim. The later
SA25a borrowed/reclaim failures waited for group shutdown; this patch removes
the same unrelated-census obstruction, without claiming their exact transient
PID cause was retained. Push remains held until SA25a lands and the coordinator
lifts the engine-main hold.
