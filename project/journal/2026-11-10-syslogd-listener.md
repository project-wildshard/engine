# Admit only the macOS system log daemon UDP socket

Jake authorized the J148 macOS-service allowance for the actual root
/usr/sbin/syslogd process, PID 389, on UDP *:50611. Its ephemeral port
must not become a fixed pin. The new entry matches only UDP and exact
process name syslogd, with reason macOS system log daemon. No TCP or
unknown process is admitted; no service was stopped or reconfigured.

The new positive test fails the original implementation: 1 red, 12
passed in 163 ms. With the entry all 13 existing and new cases pass in
107 ms. Explicit negatives cover syslogd TCP, unknown-agent UDP and
syslogd-helper UDP. The actual strict local listener check now exits 0.
Browser-lane still uses its existing warning-only policy; an earlier
partial-log reading incorrectly called that warning a refusal. Both
local GRID phone proofs completed successfully before this fix too.

J206 one-shot read-only review found no MUST or SHOULD defects:
~/.cache/wildshard/session-keep/reviews/sdk-sky-engine-20261110-J148-syslogd-20261110T151307Z-28976.md.
Normal publication and a fresh SR-L7 phone run follow this commit.
