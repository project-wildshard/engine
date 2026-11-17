# Keep CPU contract checks independent of machine load

The full local gates repeatedly failed real-process CPU tooling probes
that passed unchanged alone. Routine checks now drive the production
publication, build-work, borrowing and reclamation functions against a
private process inventory, ledger and clock. No host CPU capacity, PID
churn, process startup interval or signal-handler delay decides a verdict.
The clock crosses TERM/KILL boundaries explicitly and verifies that the
reservation survives until group drain is observed.

The native `cpu-*-proof.py` commands remain explicit qualification tools;
their process, pipe and socket integration coverage is retained there.
The gate checks nine publication, six reclaim, three service and sixteen ancestry controls, plus twelve
borrowing controls at each of three capacities. Invalid identities and
ancestor capabilities still refuse. Production grace times and admission
policy are unchanged.

Validation: all deterministic controls pass with an injected kernel and
clock. External process creation and host census calls are forbidden
inside the fixtures. Python isolated mode keeps caller optimization and
module-path settings out of assertions.

Native qualification also passed on this candidate: owned publication (9
controls), service completion/helper/owner loss (3), owned reclaim (6), and
both actual direct/socket providers' borrowing and drain (12). These probes
were run explicitly before landing; they remain available at
`scripts/cpu-{owned-command,build-work,owned-reclaim,borrowed-command}-proof.py`.
