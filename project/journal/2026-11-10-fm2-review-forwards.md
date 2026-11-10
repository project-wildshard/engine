# FM2 J206 must-fixes

The restricted one-shot review of 82dcfed was NO-GO. Its report is
~/.cache/wildshard/session-keep/reviews/failmodes-engine-20261110-FM2-local-proxy-20261110T192942Z-1181.md.
Eight new real CLI/upstream cases reproduce all six categories on that
unchanged implementation: 0 passed, 8 failed, 5.361 seconds. No internet
request is needed: an independent loopback trap exposes the URL escape.

Reject backslash targets and verify the final forwarding origin before
copying headers. A slash-backslash request now returns 400, with no hit on
the canary trap. The caller's credentials never leave the intended origin.

Handle constructor and rejected-upgrade paths. Track every native upstream
until close, retain bridges until both peers retire, and close all owned
peers during shutdown. Duplicate protocols return 400 without a crash;
invalid keys leave no upstream. New accepts refuse during shutdown.

Account for pressure across both native directions and resume both senders
when it clears. A held 5 MiB downstream payload plus upstream commands
heals and continues. Bound pending message count as well as bytes, and
use cancellable absolute deadlines with safe Node timer chunks. Empty
frames cannot allocate unlimited waits; a 3 MiB/one-byte-per-second delay
stays held without wrapping to one millisecond, then heals byte-for-byte.

Validate injected header values with Node before atomic rule replacement.
NUL/invalid Unicode controls return 400 and preserve the previous rules.
Connection-level refusal is selected across directions, so a downstream
loss rule cannot mask upstream refused upgrade.

All twelve native cases now pass below two seconds, including the complete
setup/teardown elapsed assertion; scripts types and typed lint pass. The
old-red cases and original assertions remain. No game cap, protocol,
release verifier or live configuration changes. FM3 remains unqualified.
