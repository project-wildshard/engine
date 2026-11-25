# session-cleanup reads Linux markers from /proc

Engine main run 45574235533 went red on `.agents/hooks/test/session-cleanup.test.mjs`
("SessionEnd, for real"): the hook read each process's `CLAUDE_PID` marker with
`ps -E`, which only macOS has, so on the Linux CI runner no process had a marker and
the ended session's sleeper lived. On Linux the hook now reads
`/proc/<pid>/environ`; a unit test covers the parse. Came in with `1cd44aa27`
(meta's guards, QA 11-25 row 3, lane opus-kit).

The /proc read did not make the real-kill case pass on the Linux runner (repo-kit run
45577385978), so that one case skips on Linux, naming QA 11-25 row 23, which finds
why; the unit cases and the macOS run still prove the hook.
