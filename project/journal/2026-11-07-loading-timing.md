# LS1: retain the missing beginning

The old real Chromium and WebKit builds reproduced the missing collector:
neither retained the navigation/module interval for Loading to adopt.
The new HTML installs one bounded local object before modules. It records
navigation, buffered resources, scheduling gaps, lifecycle and title input
handoff; Loading and dedicated workers append to that same page history.
No card, CSS, layout, rendering behavior or telemetry endpoint changed.

The public reader contract is docs/boot-timing.md. Server world now names
its imports, storage, physics, product verification, simulation/collision,
restore and handshake boundaries. Stream counters use actual decoded
response chunks, including the early common table and server reads;
successful atomic boundaries and observed resources provide step counts.
No elapsed-time estimates or existing pro-rata wire figures enter them.
Warm held bodies can legitimately produce zero streamed bytes.

Real iPhone portrait Chromium and WebKit boots retained the early history
once and reached a rendered world. The initial cold reads reached the
first setup game step at 852/1313 ms, with zero unnamed gap, 431/433 atomic
completions and 38 streamed response counters. Sunscar also passed at
1394/2176 ms with 509/515 completions and 233 streamed counters.
These setup steps genuinely precede the later Server world startup.
The final cold rerun after adding early common-reader chunks passed at
818/1388 ms, zero unnamed gap, 435/437 completions and 206 byte counters.

Independent 1250 ms delays for first JS, styles, tables, worker entry and
worker world boot all remained named in both engines. Maximum unnamed
gap was 1 ms. The worker-boot injection waits inside the actual emitted
world-boot callback; its initial ping remains separate. Both Ring 1
worlds borrow their server inputs, so delaying a nonexistent book read
would not have exercised that boundary.

Controlled same-build warm boots retained SW cache records. Independent
SW cache-open and publication delays passed both engines too: first setup
step 25676/25935 ms for delayed cache opening and 3228/4513 ms for delayed
publication, with no unnamed gap. The latter removes only table/book
entries while retaining immutable content; it proves a metadata miss
with old content held, not a second release deployment. These are manual
milestone proofs, outside hooks. Browser processes and previews closed.

54 existing outer-edge checks passed in 1.1 s: startup module bank,
Loading waits/timeline, title preparation and real bundled SW behavior.
Types, lint, formatting and layer sides passed. The old SW fixture had
stripped a single import; it now executes the same bundled source as
production, including the explicit diagnostic clock import.

The flake fix is 600cc158 (coordinator integrated it as 9678e78). Publishing
this LS1 commit stays behind the remote v0.1.1 tag and the full real
pre-push suite, with SSH keepalives. No hook bypass is authorized or used.
