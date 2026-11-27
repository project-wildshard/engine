# Run replica fixtures with the test runner's Node

The clean push gate adds a Node wrapper to cap test workers. The replica
fixtures inherit its PATH and construct an otherwise minimal environment,
so the wrapper cannot find its real Node executable. Put the test runner's
Node directory first for the replica and configuration fixtures. This
keeps child processes on the same runtime as the tests and preserves the
fixture's isolated environment.

The coordinator approved one gated push for the fixture, interim pins,
Far Reach and Nine cook changes, SF21's dependent cache changes, and
QA28's staged-tree check. The commit records the two scoped gate options
and the exact commits used for that batch.
