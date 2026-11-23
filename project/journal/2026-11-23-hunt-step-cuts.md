# Hunt step cuts for Pine's story (QA 2026-11-23 row 2, opus-qa1)

- Pine's CI21 story (33,090 ticks, record and replay) is 97 % sim tick; eight layer hunts are a third of it.
- The roster's noise decay called the portable `Math.pow` (a JS log and exp) every tick per hunt for the same fixed
  step: now once per step length (~0.15 s of the local record loop).
- `BandClocks.row` returned a fresh object and closure on every body and brain ask (~500k a story): now the row
  itself, and the band lookup is a method.
- Both keep every bit: the same pow inputs and the same band. Local profile share of the hunts in the step:
  33.7 % before, 29.0 % after. Not enough alone for the 30 s hosted line; the rest is QA row 2b.
