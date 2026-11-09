# Keep the checked checkpoint's clock

FL diagnosis found a redundant full native continuation at tape startup.
The worker already validates and publishes its initial checkpoint.
Its first bounded part nevertheless called commit again just for the tick.
The same duplication recurred when a fresh worker restored an earned save.
No game input occurs between these two copies of a checkpoint.

Reproduce on the unchanged actual Nalati awareness input tape.
Temporary timing around the real native serializer shows duplicate wires.
Tick zero has 21921121 native physics bytes and 12785358 wire characters.
Its repeated wire has the identical SHA256 and costs 974.304 milliseconds.
The restored tick 3780 has 22117712 native bytes and 12989905 characters.
Its repeated wire costs 1102.108 milliseconds and is also identical.
This measures actual captures and encodes, not a read-count mock.
The temporary profiler was removed after the comparison.

Retain only the number from the last validated published checkpoint.
Initialize the bounded tape budget from that existing clock.
Update it for ordinary steps, walks, final observations and accepted parts.
Every checkpoint actually returned still takes its original full validation.
Part reports retain their ordered-input and aggregate-budget checks.
Malformed commits and request failures still close the worker.
No snapshot codec, transport schema, physics byte or gameplay state changes.

Actual awareness keeps all 3977 inputs, eleven parts and its earned save.
It still visits visible, noticed and detected, with exactly one hint.
Its full restored continuation and remaining original assertions pass.
Eighteen measured encodes become sixteen; all sixteen retained wire hashes
match the original in order, with no normalization or omitted state.
The two avoided encodes cost 2076.412 milliseconds in the baseline.
Observed total elapsed time was 33.30 then 19.01 seconds under changing load.
That difference is not an isolated whole-file saving claim.

Extend the existing actual worker proof after a real step and a real walk.
Restore each earned nonzero checkpoint into an independent native worker.
Both sides must publish the identical complete next continuation.
Keep the original 72-input tape and all its original refusal assertions.
Keep the original request, process and test deadlines.
The expanded proof passes in 5.52 seconds; the pre-change expansion passed
in 9.13 seconds. These are observations, not an isolated speedup claim.
The same real proof rejects three deliberate regressions: a stale clock after
ordinary steps, a zero clock after restore, and a stale clock after a walk.
All mutations are removed before final validation and commit.
One walk mutation run overlapped restoration and was discarded; the fully
drained sequential repetition rejects it and is the retained evidence.

No quarantine entry leaves on these local results.
The nine files still need their consecutive hosted qualification receipts.
The original deadlines and the standing 06:00 UTC J200 review remain.
