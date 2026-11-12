# 2026-11-12 A dead body's hit flash (TE-ENG9, opus-teeng9)

- Brasscap's beaten Dust Wyrm drew white: its body material held the hit
  flash's full white emissive. `Animal.showRow` read a blow as
  `row.flinch > this.flinch + 0.05`, but the local `flinch` decays every
  frame (the pose law's custom branch and quadruped flinch layer, a custom
  rig's ragdoll) while a dead body's row keeps its last flinch. So every
  row re-armed the flash at 1, and the corpse never faded.
- Fix: a blow is a rise in the row's own flinch since the last row
  (`rowFlinch`). General, no shard branch.
- Who saw it: every row-driven body killed mid-flash whose local flinch
  decays: custom rigs (the Wyrm, Driftwood's crab, monkey and sailor) and,
  past the tier's live-ragdoll cap or with no physics, quadrupeds too
  (Pine Hollow's deer and boar). A ragdolled quadruped never decayed its
  flinch, so it was spared.
- Test: `src/client/engine/entities/dead-hit-flash.test.ts`, red before:
  a body killed in its flash is back at its base emissive within 0.5 s
  and stays there; a live body still flashes on a second blow.
- Codex review MUST: a per-frame rising edge misses an interpolated rise at
  240 FPS (40/63 to 1 over two ticks is under 0.05 a frame). The rise now
  counts from the rows' low point since the last blow; a test covers it.
