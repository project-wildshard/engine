# Validate qualification inputs before observing

> Written by: Codex

> **State:** built locally, 2026-11-16; HOW-WE-BUILD TS12i.

A proof root and command log form one qualification input. Argument parsing
now rejects either half before selecting an owner or creating output. Both
absent retain legacy unverified observation; both present retain strict
qualification and refused raw evidence.

The real producer fixture tries each half independently. Both observers
exit 2 without a summary or raw report, while the owner stays alive waiting
for its fixture release. A liveness-only probe confirms that state, then
the fixture releases and reaps the owner normally. The existing full,
partial, stale, failed and orphan cases remain, with an added both-absent
legacy case. The former late missing-log case is replaced explicitly.
