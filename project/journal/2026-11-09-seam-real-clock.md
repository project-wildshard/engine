# M3: a crossing must leave its own server clock alive

The Opus quarantine review found a real missing liveness oracle.
The seam test paused the real server before its bounded input tape.
That is useful for reaching the seam without a fifteen-second walk.
However, the final probe helper also called grid.tick itself.
The test therefore supplied the exact progress it claimed to observe.
A broken resume handler could survive every post-crossing assertion.

Reproduce that hole in an isolated pinned engine clone.
Disable only the actual standalone server's resume message handler.
Keep the real control and game MessagePorts and all hostile bytes.
The original seam case still passes: 8.63 seconds for the focused run.
That confirms the finding on the real crossing path, not a hand event.

Keep the bounded tape and the unchanged cold road collision bake.
After the one actual travel, capture the authoritative arrived-room tick.
Send shell.resume through the real control port.
Wait 150 real milliseconds without any further test-driven grid ticks.
Require the arrived host tick to have advanced.
Require the ordinary control-port probe to confirm that progress too.
Keep the existing connected-client and exactly-one-travel assertions.
No application clock, transport, room or movement implementation changes.

The revised case rejects the same lost-resume mutation in 6.16 seconds.
The actual assertion says tick 1 must be greater than tick 1.
Restore the real handler; the focused case passes in 8.44 seconds.
The serverClock and serverHost sources match the canonical baseline.
The diagnostic mutation is removed from the isolated clone afterwards.
No skipped focused cases are reported as whole-file qualification.

The explicit Ring 2 reason and 60-second test deadline stay unchanged.
No quarantine entry is added, removed, renamed or extended.
The next sole publisher is codex-j189 while engine main recovers.
Normal hooks and the complete publication gate remain required.

The complete original net-fuzz file passes all 13 cases in 11.97 seconds.
That run has zero failed and zero skipped cases, with real pinned products.
It is a local regression receipt, not a new hosted qualification streak.
