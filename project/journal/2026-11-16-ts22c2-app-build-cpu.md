> Written by: Codex
> State: app-build CPU admission adopted; local qualification, 2026-11-16.

The authenticated heavy build child could run during an exclusive room
CPU interval. Admit it through the existing CPU ledger in its heavy-lane
owner. Publish kernel-bound command ownership before execution, inherit
lock descriptors and QoS, and keep the reservation through cleanup.
Nested builds register lifetime within their actual ancestor budget.
Refuse nested mirror/CPU ordering and a build-ticket wait that could
deadlock behind other builds waiting for the held ancestor budget.

The supported pnpm build:ring route passed twice. The second actual run
queued behind a two-slot exclusive predecessor without launching a child,
then published its real private command group and finished with both
CPU lists empty. Ring 1 generation is restored to full committed inputs
using normal pins and gen:inputs, without hand-editing generated tables.

Command controls retain nonzero/failed launch/timeout/cancellation,
three build tickets, shared CPU capacity, nested budgets and ordering.
Added ignored-TERM timeout, hard-killed actual build provider with a
resistant descendant, and scheduler-root-only nested ownership controls.
The original eight heavy controls retain all assertions and deadlines;
their FIFO fixture uses private CPU domains to exercise build tickets
on small CI runners. Shared CPU contention is checked separately by
actual command providers. TS22d still owns the complete room verdict;
no room assertion, timing limit or full-gate speed claim changes here.
