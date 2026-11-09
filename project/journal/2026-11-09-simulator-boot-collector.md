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

The ordinary grid route also now applies the same muted phone settings
that the compiled-shard route already set. Music and SFX are explicitly
off for every test browser. No progress, pose or arrival is seeded.

The real native cold run reached entered, unpaused production d915
with no reported app error. The original video analysis then refused an
inverted ffmpeg range: reveal began at 12.315 s, loader ended at 23.927 s.
Keep that M1 refusal unchanged. Persist the passive startup/collector and
control evidence before video analysis, so its unrelated refusal cannot
discard the actual LS1 timing capture. A new reading is still required;
no lost collector state is reconstructed from row timings.

The fresh native iOS 27 Safari reading on production d91507e-mw810im4
now passes the LS1 contract: first game step 3465 ms, loader-complete
6530 ms, largest unnamed gap 286 ms through loader-complete. The actual
collector has 1696 entries, 686 resource records and 838 atomic completed
steps, no overflow, the worker clock round trip and early script timing.
The original game entered/unpaused with its frame gate true. Its native
collector is retained verbatim in the owned cold-1-startup.json capture.

The independent M1 video range still refuses (reveal starts before the
loader disappears); neither its assertion nor the video was altered.
LS1's native collector proof is green; this is not an M1 visual pass.
The native device and normal full-test lease are both released. Source
collector behavior is already shipped; these manual proof readers and
this evidence still need their normal publication gate.
