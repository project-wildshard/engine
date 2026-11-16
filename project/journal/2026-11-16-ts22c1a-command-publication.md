> Written by: Codex
> State: TS22c1a built and qualified locally, 2026-11-16.

Give the next app-build provider one actual command identity before it
can execute work. A pipe barrier starts the command only after its
provider publishes the kernel birth identity, UID and private process
group. The bootstrap execs the requested command without changing PID.
Failed publication and provider exit close the barrier without running
the command. Reuse the census kernel backend for targeted reads.

Nine actual-process controls cover publication ordering, exec identity,
exit status, inherited descriptors, publication failure, provider loss,
failed launch and forged identities. The focused wrapper and both
existing census qualification wrappers pass; lint and types pass.

This helper is not wired into production yet. TS22c1b adds reservation
retention through command-group reclaim, followed by app-build adoption.
