# Keep actual same-commit platform witnesses

Written by: Codex. 2026-11-08. EG-21, J186.

Platform baselines alone cannot say that Darwin and Linux agree. Keep the
actual eight-product, 240-tick durable digest chains with the source SHA,
platform and tick count. The existing Ring 1 products job uploads that
report even if a later product build fails. No baseline is regenerated.

The comparison command requires two distinct platforms at the same commit
and clock and reports SAME or DIFFERS for every actual product. This is a
report, not a new equality gate. Capturing a second platform must finish
before claiming equality; an older baseline is not a current witness.
