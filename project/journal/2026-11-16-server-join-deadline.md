# Bound the release wait before the server can join

SB29 (WILDSHARD-GAME-8V) has three events/users, including staging v30
f8ff9bd9 on visible Mobile Safari. Its files/render steps completed,
then the server stage stopped progressing for114seconds (61 in another
report). This is distinct from the Enter World menu loop and Mu9's
placement/cook incident. Safari's connection=unknown is the missing
Network Information effectiveType, not a measured WebSocket state.

The code defect reproduced here is an unbounded release-read wait.
The promised8second limit only called AbortController.abort; a producer
that did not settle after cancellation kept startOnline awaiting forever.
Body reads shared that gap, signature verification had no deadline at
all, and even rechecking the kept copy could wait without a bound.
The actual affected client's pending operation was not recorded in the
supplied event, so this is a reproduced cause consistent with the stall,
not proof that every event hung at the same operation. The additional
event operations/waits have been requested through the coordinator.

Test first: the real release reader and real connection screen failed
at8seconds, despite an aborted signal. One deadline now races the whole
fresh read/body/signature operation; cache revalidation is also bounded.
The existing screen/retry policy handles expiry. Aborting still asks the
producer to stop, a late result cannot return through the timed-out
attempt, and only an accepted verified read updates the kept release.
Fetch/body/signature stalls all show the actionable screen and recover
through Try now; cached verification falls back. Existing signed-file,
rollback, offline and screen tests remain in the focused23case run.
No release authenticity rule, seating grace or automated-event filter
changed. Hosted qualification and staging acceptance remain required.
