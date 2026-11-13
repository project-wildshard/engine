# 2026-11-13: Respawn now on the death card

> Written by: Claude (opus-respawn)

Jake on preview Sky Reach, iPhone: the fall's respawn card "took forever" and needs a Respawn now button. Measured headless
WebKit 402×874: the card waited on nothing but a fixed 1.8 s timer (the server places the fallen player on the death tick;
the page held that pose until the timer's dark), and online the server held the player's commands for its own 1.8 s fade.
Death to moving again was 1,962 ms. Now the card has a Respawn now button (tap, Enter, Space; a `ready()` gate with a
"Respawning…" state, capped at 3 s), the automatic wait is 1.35 s with at most 0.25 s per frame, and online the press
sends `RESPAWN_NOW_ACT` so the server ends that player's fade (no move, no heal). Death to moving: 431 ms with a tap,
1,517 ms without. The button's words live in `play.ts`, because the engine string table rides in the title chunk.
