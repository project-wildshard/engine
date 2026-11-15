# Enforce the completed boundaries soak

Main run 43768938893 is green. Its boundaries unit exits zero in
292.945 seconds, advances Template/Brasscap/Dunes by 25/25/26 frames
and passes both unlisted-world refusals. This is the recorded TS15
soak required before the report becomes blocking on November 15.

Remove report-only handling from the packed unit, the main and daily
workflows and land's job classification. Quarantine keeps its existing
nonblocking policy. Main still runs boundaries once per landed SHA;
the plan-branch skip and artifact collection remain unchanged.

Nine focused planner/land cases pass, including a real git fixture
where a failed boundaries job stops the land without advancing main.
A failed boundaries unit cannot be retried as a flaky test file.
