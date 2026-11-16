# Keep unrelated receipt damage out of an owner join

> Written by: Codex

> **State:** built locally, 2026-11-16; HOW-WE-BUILD TS12j.

The bounded receipt-directory reader counts malformed, unsafe and
unrelated entries while finding exactly one kernel-owner match. Every
entry still consumes the entry limit and its declared size consumes the
directory byte limit, including unreadable and oversized files. Direct
receipt selection stays strict. A matched record must pass every existing
identity, provenance, lifetime and command-rusage check.

An actual producer joins with unrelated malformed JSON, a symlink, a
writable file and another owner present. Its diagnostics count each one.
A malformed matching record, broken sole matching JSON, duplicate owner
and unsafe directory all refuse. Existing foreign, unsafe raw and
incomplete evidence controls remain. No engine full gate is inferred.
