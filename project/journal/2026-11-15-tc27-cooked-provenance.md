# Cooked provenance for every Ring 1 product

> Written by: Codex
> **State:** source complete, 2026-11-15; hosted gameplay proof pending.

The blocking boundaries job exercised the cook store for Blender and
Dunes, but Template still used its bundled build. The aggregate fetch
check could also pass with only metadata, or with another head's bytes.

The proof now retires the bundled routes before production
`addStoredShards` attaches all three products. Every individual gameplay
boot must fetch an actual compressed client part, and every fetched key
must belong to that product's cook index. The receipt records those keys
per product as well as the combined inventory. Missing/duplicate product
indexes and an installer that preserves Template refuse qualification.

No runtime, pins, shared nightly code or cook implementation changed.
`node --check scripts/cook-to-play.mjs` passes. The Mac mini does not run
the cook or graphical proof locally; normal branch CI owns that evidence.

Hosted report 43783265173 exposed an independent gating gap: six existing
released-save cases fail (five eagerly read GLBs from server-only slices;
Blender's old-level refusal expectation also disagrees with today's pin),
so Actions skipped cook-to-play entirely. Those cases belong to TC29/33
and are untouched. The report now lets the stored-product proof run once
input setup succeeds, even when another report step fails; cancellation
and failed setup still stop it. No failure is hidden or made green.

J206's workflow review also requires a successful browser-install outcome
before cook-to-play. That step now has its own id and the proof checks
both input and browser setup outcomes, plus cancellation. Actionlint is
clean; the earlier report failure remains unchanged and visible.
