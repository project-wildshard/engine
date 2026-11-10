# Forward the optional Ring step flag on system Bash

The G5 actual global-store Ring1 all flow reaches a shell failure.
The system interpreter is GNU Bash3.2.57 on macOS.
The script enables nounset before its stage functions.
An empty local array is declared in cook_step for the optional flag.
Expanding that empty array under nounset throws before the step starts.
The actual command reports update[@]: unbound variable at line35.

This is reproduced by the normal scripts/ring1.sh all path.
Its static type/lint/format/sides/page-event stages pass.
All5503 Ring1 cases pass with one existing skipped case.
The three actual products cook successfully in27seconds.
The step never starts and build/boot are not reached.
The full failed flow lasts462.89seconds and its log is retained.

Use the function positional argument vector for the optional flag.
set -- creates the empty vector on entry to cook_step.
RING_RECORD=true sets that vector to exactly --update.
The same original stage step command forwards the vector with quoted at.
An empty quoted positional vector is supported under system Bash nounset.
The function-local vector does not replace the caller script arguments.

No product, case, fixture, clock or shard budget changes.
No update mode is used for this proof and no baseline is rewritten.
The ordinary absent RING_RECORD path is the reproduced failure.
The existing nonempty branch still forwards exactly one --update token.
No fake cook or new unit test mirrors this shell implementation.
Actual original cook/step and full flow provide the outer-edge proof.

The owned first failed flow's fresh cook output is preserved separately.
The targeted positive path uses a new empty output and a real CPU grant.
The private GVS flag and generated product book remain unpublished.
One-shot review and normal source commit follow the actual path proof.

The exact focused cook-step command now exits0 under system Bash3.2.
It performs three fresh real cooks before reaching the original step.
The unchanged real step validates240ticks on all seven product cases.
All seven canonical expected hashes match, with no update mode.
The step stage takes20seconds and is green.
The one-shot J206 review returns GO, no MUST or SHOULD.
