# Fix the shell clock test time

The release36 full suite passed9801 tests and failed this clock assertion:
it assumed the document was less than ten seconds old. A busy worker reached
10.6 seconds before the assertion. That is valid product behavior.

Set performance.now to12.5 seconds in the test and assert the exact14-second
clock from the tap1.5 seconds before the document. This failed red first
against the old regex. Restore the spy after each case. Runtime stays the same.

J381 resumes the existing release36 branch push with SKIP_CHECK after the
full9801pass/one timing assertion result; exact hosted13 still gates staging.
The forward test fix follows normal main-push checks without an escape hatch.
