# Explicit environment owners keep the same suite

CI12 separates configured Node and DOM files into explicit projects. The
existing environment annotation still owns each file; unannotated files
stay Node. Native Three math stays legal there. Unknown environments
refuse clearly instead of receiving a guessed project. No tests or
annotations are removed, and every project retains isolated forks.

The exact CI and push cohorts rebuild their projects from their selected
includes/excludes. They cannot inherit the root's full projects and run
unplanned files. Both projects keep the same worker limit and group order,
which Vitest schedules as one bounded group, not two additive pools.

Actual discovery must retain the original complete union, and real tiny
Node/DOM tests must prove ownership and wrong-owner refusal. This CLI proof
stays outside local hook discovery. The mixed quest-reward DOM test is
preserved; moving its page assertions remains an Opus task.

Publication remains reserved for port's v0.1.2 release. This local source
is excluded from that release unless explicitly handed over as fix-forward.
