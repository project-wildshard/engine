# Probe the actual proof writer only at publication

> Written by: Codex
> **State:** built locally, 2026-11-16; HOW-WE-BUILD TS12g.

A clean-tree capture retains the profile and lease inputs without spawning
Python or ps. Fresh publication takes one kernel identity snapshot and
validates its actual lease, then timestamps the completed receipt. Reuse
keeps the original producer. Cache admission and runtime fingerprints stay
the same, including compiler environment and exclusion expiry.

The real Git/kernel fixture installs counting executable shims only in its
own CLI child's PATH. The old implementation fails because initial capture
spawns both Python and ps. Fresh publication now runs each once; subsequent
comparison, pre-lease/release-check capture, reuse and legacy reuse run no
producer probes. Fresh owner identity, profile, partial coverage and wrong
lease refusal remain checked. The actual validated initial lease may have
null childPid: publication and cache parsing preserve it. The strict census
join's existing null-child refusal still prevents command qualification.

Validation: owner fixture, two actual producer joins with 25 refusal
controls, and nine observer CLI paths pass. Real cache, Git hook/compiler
and exclusion-expiry controls pass. These are fixtures, not engine suites.
