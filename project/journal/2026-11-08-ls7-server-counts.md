# LS7: expose the server worker's own work

Written by: Codex. 2026-11-08. Follow-up of meta LS7 / ask A4.

LS1 already forwarded the worker's internal task completions, but the
card ignored them. The real Dunes boot's Server row was blank inside
itself. The first attempted clock-only reader exposed that the worker
can finish its 38 ms boot entirely between clock ticks; it saw seven
page tasks and zero worker files despite the collector holding them.

Read actual collector events as well as the existing clock. Scope the
projection to the current server launch and worker realm, count only
completed operations, and credit four guaranteed startup boundaries.
Optional file counts do not invent a denominator. Verified byte counts
emit only after the real size and SHA-256 checks succeed, including bytes
lent from the page. They are verified input bytes, not network bytes.

Both real Dunes browsers now show 48 completed server steps, 33 verified
files and 447,083 verified bytes, without a timer manufacturing work.
The strict bar check is unchanged and still refuses the renderer stall.
No protocol, graphics, shader, deployment or shared checkout changed.
