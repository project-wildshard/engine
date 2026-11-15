# Restore the admitted Brasscap pin

> Written by: Codex
> State: main recovery, 2026-11-15.

Run 43770588120 failed products, not a unit assertion: Brasscap rev 5
fails the real capsule entry walk at east lane 0, 47.20 m inland,
feet y -0.1509567 (the limit is 0.15 m). The same engine and cold cook
prove rev 3 successfully in 21.8 s. Rev 5 reproduces the hosted refusal.

Engine 7836ef04 (opus-brassgun4) changed the pin after the green
REPO-DISK branch. REPO-DISK changed no pin, terrain or edge proof.
Shard-brasscap 57e5c6f renames creature kinds; its scene terrain comes
from 003218b and flattens only beyond radius 230, fading from 190.
The 50 m entry proof reaches that fade. Moving camps is not this failure.

Restore the admitted rev 3 fixture, save refusal and matching stair
route together. Keep the edge admission unchanged. Rev 5 needs a new
source revision with clear entries and a full cook before repinning;
this recovery does not move staging or production channel pointers.

Verification: the unchanged production bounded worker cooks all three
Ring 1 products successfully: Template 43.2 s, Brasscap 26.3 s, and
Dunes 22.7 s. Game lint passes. The initial pin unit run found the
checkout missing Template's published program; run the required
`pnpm pins` before repeating the fixture checks and normal push gate.
