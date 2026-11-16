# 2026-11-16 BUGBASH-LOOP: one loading screen after Enter World

> Written by: Claude (opus-bugbash)

Jake sent four recordings of staging v0.1.30 (12:49 to 13:05 Cancún). After Enter World he saw one of: the bare launch shell; the main
menu with the play HUD drawn over it; Shard Select again; a black screen with a thin bar. On his phone it sometimes never
entered the world. The cause is PZ27 (dea4412c, 33ccae77, bc25312e). It set `html.boot-menu` on world pages as well as the title. It mounted a
"preparation menu" over the loading world without `#hud.intro`. It shrank the world's loading card to a 3 px bar. This commit
keeps the launch shell and the live menu on the title only. It removes the preparation menu and the shell's native Shard Select, and it
restores the full-screen loading card. Two checks now tap the journey at 402x874: `scripts/journey-proof.mjs` (a CLI, the staging gate)
and `src/e2e/t1/journey.spec.ts` (T1 shard C). Both fail on any screen other than a menu, the loading card or play. Staging f8ff9bd9
failed the check in 4 of 4 runs before this commit.
