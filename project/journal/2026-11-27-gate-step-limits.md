# Every gate copy step has a limit (QA 11-26 row 29)

An engine push gate sat 44 minutes in `pins install` inside its clean
copy. Each step the copy runs (the isolated install, the install, the
pins) now goes through `gate-step.mjs`. The step runs in its own process
group with a limit: `WS_GATE_STEP_S`, or 300 s for an install and 900 s
for the pins. Past it the group gets TERM, then KILL, and the gate fails
with `gate step <name> stuck`, naming the step and its last output.

`pins.ts` fetches now stop on a body that sends no bytes for 60 s
(`WILDSHARD_PIN_STALL_MS`). A stall is a transient miss, so it retries
and then names the URL. The copy also borrows the checkout's verified
pin mounts when a pushed commit moves a pin key, so `reuseUnchangedPins`
can keep the unchanged pins instead of fetching them again.
