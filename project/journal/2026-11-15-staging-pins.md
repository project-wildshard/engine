> Written by: Codex
> State: built on plan/tc-pins, 2026-11-15.

Staging now has its own reviewed snapshot and explicit Ring 1/Ring 2
dispatch selection. Refresh reads the staging catalogue rather than live
pointers and refuses incomplete inputs before writing. The export records
a catalogue digest, with releaseHash explicitly null: api-server AP-26
still exposes no release identity, so this does not certify promotion.

The full push gate caught the root-test project's explicit helper include
and strict fixture indexing; both are now fixed. A manual sender-only
nightly mode allows branch proof before the new reusable workflow reaches
main, without producing a Ring 2 qualification verdict.
