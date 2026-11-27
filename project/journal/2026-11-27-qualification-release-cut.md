# Use the exact qualification run for a release cut

Busy main queues replaced three v0.1.99 candidates before their push CI
started. A qualification dispatch of `ci.yml` already has its own
concurrency group and records the exact main SHA that ran.

The release train lists successful main runs and reads back their exact
workflow, branch, event, SHA and jobs. Both push and dispatch runs must
prove the packed tests and the required build jobs. The prepared release
branch keeps its existing exact push CI check.
