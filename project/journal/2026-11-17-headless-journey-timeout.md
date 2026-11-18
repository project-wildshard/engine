# Allow headless journey worker startup under CI contention

Run 44237829051 returned a null status from the headless journey
child after the file reached 20.447 seconds. The child had only
printed Node startup warnings at its 20-second watchdog. Four
earlier hosted passes took 8.9, 19.0, 10.9 and 15.1 seconds. Both
cases pass on the same source locally.

Give the five-worker native proof 35 seconds and the enclosing
case 45, within the existing 60-second file budget. Include the
spawn error and signal in any assertion failure. The fixture,
physics steps, and all parity, retirement and refusal assertions
stay the same.

With the same 15-second startup delay, the old child reported
ETIMEDOUT after 20.046 seconds. The candidate completed in
20.298 seconds and ran the original assertions. The control
also rejects attempts to load either changed renderer module.
