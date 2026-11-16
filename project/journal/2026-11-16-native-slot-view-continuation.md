# Native slot view continuation

> Written by: Codex
> **State:** source repair, 2026-11-16.

The real King shield replay exposed a view guest's host sequence reset,
then its unsaved mutable globals. Continue the host scheduler, rate and
freeze policy, batch totals and admitted globals alongside guest memory.
Keep this state after the first call, including between actor spawns.

Globals use integer bit words. Lazy memoryless Wasm bridges preserve NaN
payloads that JavaScript float-global access canonicalizes. The frame
path does no new work; retirement drops the bridges with their globals.
Validate the complete continuation before replacing live values.

Thirteen real-Wasm cases pass, covering pending frames, rate recovery,
refusal, partial freezes, nonzero batches, i64 limits, signed zeros,
non-finite payloads and invalid later-global atomicity. Full compiler
and focused lint pass. J206's non-finite MUST and totals/legacy SHOULDs
are fixed; follow-up review found no further global-bit issue.

Legacy native saves have initialized globals and fixed-rate host clock
fallbacks. Old sinking-corpse saves lacked guest globals already and
remain unqualified. Full final-engine Nalati rewards remain separate.
