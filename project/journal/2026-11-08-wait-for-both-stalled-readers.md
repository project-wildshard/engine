# Wait for both actual stalled readers

CI 42507055884 on source ef385ad fails tests shard five.
Job 128812834839 names the real net-socket-room stalled-reader case.
The exact healthy-client assertion expects fifteen frames but receives sixteen.
This is a blocking assertion failure, not a reason for another quarantine.
Ten-run qualification cannot count a workflow with this failure.

The test creates a healthy reader and two independent paused WebSockets.
Both paused readers continue real keepalive traffic while their buffers fill.
Each has its own OS receive window and server-side send queue.
The fill loop watches only the first paused reader's onClose callback.
It then assumes the other has also left before counting one client's frames.
On the failed hosted run the second transport remains for another frame.
The room correctly frames that still-present transport as well.
The first-close observation does not establish the assertion's precondition.

Watch both actual server-transport close notifications before that boundary.
Keep the same 200,000-tick outer cap and the same real per-tick event load.
Keep both real paused sockets, keepalives and healthy reader.
Require both actual reasons to say stalled.
Check the second transport's actual stall bytes against the same bounds.
Require its frame skipping as well, without simulating a close or event.
The original transport's loss, threshold and byte bounds remain.
The subsequent thirty actual room ticks must still generate exactly fifteen
frames for the remaining client, with no dropped state or missing events.
Grace-period close and a reader waking to the correct close reason remain.
No production transport, room, clock, threshold or timeout changes.

The unchanged old case passes locally in 2.20 seconds including collection;
that does not contradict the fetched exact hosted 16-versus-15 failure.
Afterward all eight original socket cases pass in 10.58 seconds total.
The repaired stalled-reader case takes 1.099 seconds.
The real 32-player/900-tick DirectLoopback/socket comparison remains exact:
1,222 facts, 262 receipts, zero dropped frames and the same final state.
This forward fix adds no retry, skip, case deletion or quarantine entry.
