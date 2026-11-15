# Enforce the completed boundaries soak

Main run 43768938893 is green. Its boundaries unit exits zero in
292.945 seconds, advances Template/Brasscap/Dunes by 25/25/26 frames
and passes both unlisted-world refusals. This is the recorded TS15
soak required before the report becomes blocking on November 15.

Remove report-only handling from the packed unit, main workflow and
land's job classification. Quarantine keeps its existing nonblocking
policy. Main runs boundaries once per landed SHA; the plan-branch skip
and artifact collection remain unchanged. The daily Ring 2 report has
extra steps outside this soak and retains its existing report-only job.

Nine focused planner/land cases pass, including a real git fixture
where a failed boundaries job stops the land without advancing main.
A failed boundaries unit cannot be retried as a flaky test file.
That classifier proof is defensive: current plan runs skip boundaries;
the blocking main job and main-watch enforce the real post-land gate.
