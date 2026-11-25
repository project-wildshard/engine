# 2026-11-25: the error card names what really failed

A level load that failed and then failed its cleanup showed only
"AggregateError: Level load and cleanup failed" (friction F33, 11-16). The
real cause sat inside the aggregate and never reached the card. Now the error
card and the drop card both list up to three inner errors and their stacks,
so the first thing anyone reads is the 404 or the mask error, not the wrapper.
Meta MMO-OBSERVABILITY OB10.
