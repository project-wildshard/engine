# Answer entry requests made inside a cell

> Written by: Codex
> **State:** fixed forward, 2026-11-17.

Hosted run 44018874243 warned that online-zone-enter took 63.118 seconds
against its unchanged 60-second budget. The refusal case spent 12.1
seconds despite standing still and checking only a rejected request.

The client sent `enter` from inside Driftwood. Only a road listens for
that control, so the cell silently ignored it and the client resolved
null after its ten-second unanswered-request timer. This was a missing
server response, not necessary waiting in the proof.

The door now answers a seated cell's request with `not-at-gate`.
It checks the socket and current seat each time, so the same socket
can still enter from a road after crossing there. Closing the socket
removes the listener. The road continues to own real gate admission.

All six original entry cases, native rooms, sockets, crossings, waits,
deadlines and assertions remain. The refusal case adds a five-second
upper bound below the unchanged ten-second client fallback. That
control fails first at 10,000.3 ms on the old server. All six cases
pass after the response fix. Typed lint passes with no bypass.

This is standing mini M2/M10 work after the coordinator's ownership
hold expired. The 00:15 rule forbids every gate bypass; if the normal
push gate blocks, mini QA95 records it for Jake.
