# 2026-11-19: one quest tracker badge at a time

Lane: buddy-engine (Coordinator, QA-FEEDBACK 11-19 row 28).

Jake, Mossgate and Brasscap: the tracker under the minimap drew two badges over each other ('LIGHT
BRAZIER' over a fading 'COMPLETE'; 'QUEST COMPLETE' over 'REPORT | SHERIFF 114 M'). "We shouldn't even
be having overlapping badges like that ... That's a bug." Every quest on a page builds its own
QuestChip, and every chip's ObjectiveLine is placed in the same spot. A finished quest's chip keeps
saying "Quest complete" for the rest of the page, so any zone with two quests stacked them.

The chips now share the spot. A fresh completion holds it for 2.5 s; after that, the most recently
changed objective has it. A finished quest's badge stays only while no other quest has a goal. A chip
that gives way leaves at once (`ws-quest-yield`, display none), so the old badge is gone before the
new one fades in. The clock is the chips' own frame time, and a restarting frame clock keeps the hold
at its length. The HUD's toast column anchors to the chip that is drawn. The tests cover two updates in
one frame, complete then a new objective, a lone finished quest, a disposed quest and a restarted
clock; four of them showed the stacking on main.

Row 28's other half, the blank white vitals bar in Mossgate, is not in this commit: it is not a
declared counter (Glowfen declares none), the load-progress bar or the strip's CSS. It needs a
reproduction of the Glowfen HUD at phone width.
