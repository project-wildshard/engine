# A dead push gate's lease stops being named as the holder

opus-t2e1b's pre-push timed out after 5 min waiting for the full-test
slot, and the timeout named two holders. The second was
`full-test-414c0412f6f03834`, held for 2.8 h by a push gate whose runner
and child had both died, probably SIGKILLed: its cleanup never ran, so
its `.active.json` stayed behind.

It never blocked anything. Admission goes by `flock`, and that lock died
with its owner; the slot was also a per-push gate copy's own checkout.
But `queue_timeout` globs every `full-test-*.active.json` into the
message, so the dead lease read like a 2.8 h holder and sent the
coordinator looking in the wrong place. The real holder was the first
one named: a whole-suite run (`node scripts/vitest-tmp.ts run`, lane
w2:p5, with no checkout) that takes `full-test.lock` exclusively and so
shuts out every scoped gate.

`reap_dead` now takes the slot's own lock, re-reads the lease, and
removes the file when every pid it names has exited. A lock that is
still held with both pids dead means an orphaned grandchild inherited
the fd: that's a real holder, so it stays and is named. The check and
the unlink run under the slot's lock, so a new owner's lease (always
written under that same lock) is never removed.

The claude -p review found no MUSTs. One SHOULD was fixed (a pid too big
for a C int made `os.kill` raise OverflowError, so the check is
bounded). Another was noted: a stale unscoped `full-test.active.json`
can't be reaped while any scoped run holds the barrier shared. That's a
residual gap, not the incident.
