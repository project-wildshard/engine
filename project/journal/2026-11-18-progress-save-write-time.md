# The progress-save test reads "within a second" at the write

Main run 44339095464 (dd22250a) failed `tests (8)` on
`test/standalone-progress-save.test.ts`: a Driftwood quest step was in
the page's storage after 1,226 ms, against a one-second bound. It was
the first time in the last 25 failed main runs.

Locally the continuation write lands about 0.05 ms after the quest
starts, in the same turn as the step. The test measured from the
moment it saw the quest start to the moment its polling loop next saw
the write. The standalone server runs on the test's own thread, so a
busy runner stalls between those two looks, and the stall counted as
save latency. It is the same blind spot as the tile fence and the
stuck-step watchdog earlier today.

The fake storage now stamps each continuation write as it happens, and
both "within a second" tests (the door and the quest step) compare that
stamp with the moment the change was seen. A save that really comes
late still fails. A thread stall after the write no longer does. With
1.5 s of busy-waiting added right after the quest start, the old check
would read over 1,500 ms; the new one passes.
