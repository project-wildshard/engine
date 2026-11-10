# Wait for both release pack tools

Q294 and Q297 failed the same inherited release-pack fixture when its boot
request timed out during Vercel setup. The local rendezvous now releases both
tools once both requests have arrived. The producer still has its 12-second
deadline, and timeout signals its existing process-group drain. Fixture
teardown wakes any blocked request and closes the server.

All ten Python cases passed in 9.038 seconds. A control delayed the second
request 3.4 seconds after the server saw boot. The old fixture failed in
3.727 seconds and the new one passed in 4.004 seconds. An intentionally serial
copy still failed at the 12-second producer deadline. The latter is a manual
Ring 2 control because it must exercise the real timeout.
