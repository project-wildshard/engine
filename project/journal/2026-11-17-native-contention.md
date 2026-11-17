# Run native contention rehearsals serially

> Written by: Codex
> State: HOW-WE-BUILD EV6c, 2026-11-17.

The routine full gate and nightly matrix both picked up three nested
rehearsals that requested the whole machine. Under load, those outer
requests hit the five-minute broker deadline before the rehearsal began.

The real net and physics suites keep their existing exclusive admission.
One isolated nightly job rehearses all three in order under one outer
grant. Each rehearsal still proves admission queues before collection,
the original cases pass, and the private broker releases every grant.
