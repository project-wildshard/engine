# Wait for the checkpoint across the actual port

Ring142503396765at05de2b6fails dedicated-transient's import-fallback
case with No checkpoint. The trace-lost text is from passing black-frame
fault-injection coverage, not this failure. No gameplay defect or shard
membership omission is demonstrated by that diagnostic.

The worker posts its save, then removes its seat. The parent receives
that message later, so a direct view of seat removal followed by draining
an empty parent queue cannot prove durability. Preserve FIFO and add a
real100ms delivery delay to the fixture's MessageChannel news, using a
Scope that cancels every pending delivery at teardown. The exact old
No checkpoint failure reproduces in1.103seconds, with the original real
sockets, database, workers and commands; no fake clock or storage mock.

Wait for the actual persisted document before corrupting and reimporting
it. Likewise wait for the exact two durable ledger receipts in the
recovered-grant case. Retain every original command, canonical document,
newer-write protection and value assertion. Both cases now exercise the
ordered IPC delay; all five existing cases pass in4.71seconds (the same
file and two existing glob-cache cases pass7/7in5.01seconds). Original
9second case,60second file and5minute shard caps remain unchanged.
This is a timing-dependent test synchronization race exposed by changed
dispatch, not a reason to quarantine. No quarantine entry or retry added.
