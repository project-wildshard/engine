> Written by: Claude (opus-grid)

# 2026-11-24: a stuck push gate step stops itself (J505)

Jake, 2026-11-23 ~20:40 Cancún: *"make it a permanent fix ... No queues. No freezing, no waiting."* On 11-23 an
engine-quickfix `main-push.mjs` sat 35 minutes in run-checks until it was killed by hand. `parallelChecks`
(`.githooks/push-checks.mjs`) now gives every step a watchdog at about 3x its normal time: 240 s a step (the whole gate
runs in ~74 s), 900 s a Vitest step, `WS_PUSH_STUCK_S` to override, scaled up when the 1-minute load is over the
cores. Past it the gate stops the step, prints `STUCK in <step> after N min`, appends a STUCK line to
lane-receipts.log and fails, so the push is refused and the commit kept. Test: `test/push-stop-cause.test.ts`.
