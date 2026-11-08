# Bound cold native preparation separately from Escape

Release validation found Ring 1 red on 1353d53: run 42462187339 passes
5203 cases but refuses browser-escape before any case starts. The hook
at line 22 times out at Vitest's implicit 10000 ms. Its only operation
reads the complete selected native executable, shared libraries and
startup resources into the OS page cache. No browser has launched yet.

The lift separated this cold disk I/O from the original ten-second
endpoint and twenty-five-second child clocks, but left the new hook
with an unrelated ten-second default. Give only the bounded file-read
preparation an explicit sixty seconds on a cold shared runner. Read
errors still reject, and the original startup, refusal, trusted-input
and process-drain assertions and deadlines remain untouched. This is
the genuinely long setup operation, not a larger gameplay timeout.

The failure is observed on the actual Ring 1 runner, not inferred from
a review or replaced with a synthetic success. Focused native-file and
actual trusted-input controls, then full normal hooks and new exact-SHA
CI/ring-1, remain required before v0.1.2. Save epoch remains one.

The three complete-file selection/read controls and the actual native
trusted Escape control pass together in 3.51 s. The focused invocation
selects four cases; the other five remain for the normal full suite.
The real browser's original trusted down/up and cleanup assertions pass.
