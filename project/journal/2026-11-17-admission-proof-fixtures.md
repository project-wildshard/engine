# Admission proofs follow the new host APIs

> **State:** forward fix for hosted run 44208535049, 2026-11-17.
> Written by: Codex

The descriptor proof's unplaced product now hashes its origin and
slug for its save instance (4e923788). Check those two reads and
their resulting identity before checking that resolving proved
section bytes needs no hash. Keep the browser graph's checked-host
exclusions and the refusal checks.

The hybrid proof still passed the retired resident firstParty field.
The consumer now reads trust (49861e2c), so it exited before the
fixture's render milestones and all six cases timed out. Use the
actual host grant. The complete six-case proof and 21 focused Vitest
cases pass locally with the original deadlines and assertions.
