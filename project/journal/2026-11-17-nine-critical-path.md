# Build Nine beside the packed producer

J400 FL5: free-runner main run 44035389220 spent at most 571 s
inside the nine packed shares, but 1040 s overall. Products'
496 s preceded Nine's 216 s build and its observation runners.
The dependency chain exceeded the 9–11 minute main target.

Run the existing exact-reuse and fail-closed code classification
inside Nine's build job, with full Git history. Products has no
additional job-level filter. Its code-run conditions and helpers
match this independent path. Only Nine's exact artifact gates its
load and street observations. Retain current upstream policy: producer
and props load gate; hosted virtualized-Metal street is report-only
until a real-GPU runner qualifies it (upstream 07892bce).
Keep the original full Nine build, runners, measurement windows,
ratchets, timeouts and artifact provenance.

The workflow dependency control failed first. The observed cost
fixture follows the actual dependency graph, rather than assuming
that a job name means independence. Workflow lint, focused J400
controls, game lint and types pass. Review found no MUST. A new
successful hosted observation is required before claiming the
9–11 minute target. The unchanged five-minute build cap remains
subject to that real measurement, including its new classifiers.
