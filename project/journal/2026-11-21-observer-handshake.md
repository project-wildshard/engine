# Keep the release observer alive through a rejected socket

The v0.1.65 staging observer armed two durable checkpoints before rooms
advanced from 130 to 131. A socket upgrade received HTTP 429. The Node
WebSocket emitted an unhandled error and ended the process before it could
write a continuity report.

The staging adapter now listens for that event. The existing close event
still drives the bounded observer recovery and its normal checks against
the signed release and room health. A regression test reproduced the
uncaught 429 before the listener was added.
