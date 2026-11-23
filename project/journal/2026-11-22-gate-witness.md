# Require a witnessed gate before recording an arrival

The v0.1.72 rollout proof stayed at (233.93, -4.4) in Driftwood.
Every sample gave an empty gate cell with the default count of five.
The probe still ran its fire leg, where the old world's ready bit was
enough to write a screenshot labeled as a new arrival.

Require the intended cell and count before moving through the detailed
proof. Save the blocked position when a count is missed. Capture loading
from the visible navigation card, and require control in the target
cell before saving the entry. The deploy smoke already checks target
control and keeps its existing path.

The saved rollout sample now stops at gate-5-held. The same probe
on aligned v0.1.72 reached Nalati, kept one socket, and walked out.
