# Leave headroom before the named shard wall gate

Tagged cfd6681 attempt one is green, but its shard two takes 276 seconds.
Attempt two's shard five reaches the five-minute outer timeout and GitHub
calls it cancelled. No tagged workflow was rerun by this lane.

Refresh all 1,129 blocking file weights from complete green module
diagnostics in run 42483388741, then take the maximum with cfd6681 attempt
one's actual hook/test time plus that file's measured admission overhead.
All 1,129 tag log entries match; 425 need the slower second observation.
The full basis is now 1,607.237 complete file-seconds. Use seventy seconds
setup (observed maximum 66.123) and 1.35 phase scale (observed maximum
1.2238 plus ten percent, rounded up). Provenance stays in durations-source.

Six shards model 265.30 seconds; seven model 237.41 and 94.04 percent of
the measured N=1-to-12 gain. Seven is the smallest count with both the
ninety-percent gain and twenty-percent headroom criteria. Ring 1's own
curve still selects six. These are conservative models, not hosted green.

Keep the actual five-minute limit. Record the clock in the first job step,
bound the real shard command by its remaining time and emit the named
CI_SHARD_BUDGET_EXCEEDED annotation plus a receipt. The same existing
owned-process drain catches detached descendants. Check again after the
artifact upload. A seven-minute outer guard gives reporting time; it does
not extend the explicit 300-second acceptance gate. File budgets remain
sixty seconds, all memberships/atomic native groups and gates stay intact.
