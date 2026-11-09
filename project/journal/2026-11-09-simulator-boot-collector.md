# Retain the native Simulator collector after control

LS1 still lacks its native Simulator reading. The existing official
sim-grid-entry reader already has a passive --startup-trace=1 capture
after the original controls/frame window. Include the real inline LS1
collector in that same Inspector read. No readiness, frame, memory,
cache, navigation, quiet-window or deadline behavior changes.

The new field is local proof evidence, not a product export. Nothing
is sent to telemetry. The manual validator requires the exact build,
every original navigation/worker/first-step/loader-complete boundary,
no collector overflow, real atomic work and no unnamed gap over one
second through loader-complete. Unresolved spans cannot cover gaps.

Syntax and diff checks pass. The actual native reading is still pending
the production v0.1.3 promotion and a normal Simulator quiet window;
this commit does not mark LS1 or any plan row done.
