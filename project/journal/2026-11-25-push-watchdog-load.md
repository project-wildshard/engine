# The push watchdog re-reads the load

> Written by: Claude (opus-sweep), 2026-11-25. Meta QA 11-24 row 33.

v0.1.83's push gate stopped a Vitest step as STUCK at its 900 s limit while the machine's load had climbed past 50 after
the step began: the limit was scaled by the load once, at the start. Now, when a Vitest step's watchdog fires, the gate
samples the 1-minute load per core again; while it is over 1 the step gets up to another minute, never past 3x its base
limit (or its start limit when that was already larger). Other steps never extend. `stuckExtensionMs` is pure and
`test/push-stop-cause.test.ts` holds the extension, the re-sample and the cap. Exact hosted release CI still decides.
