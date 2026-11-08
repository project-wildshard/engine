# A file budget includes importing the file

The first reporter measured only tests and hooks. A real sixty-ms module
import plus an empty passing case incorrectly exited green at a twenty-ms
budget. That reproducer is red before this correction.

The reporter now sums the actual Vitest diagnostic phases: environment,
prepare, setup import, module collection and tests/hooks. It retains the
separate tests/hooks and collection numbers for diagnosis. The fixed
sixty-second ceiling can only be lowered for an outer-edge negative proof.
Both a real timed case and a real timed import must be refused by CI's
planning job. The shard runner independently checks the emitted total.

This strengthens the existing cap; it changes no test assertion, case or
deadline. The first hosted overruns remain documented using their original
reported tests/hooks numbers rather than being rewritten as new totals.
