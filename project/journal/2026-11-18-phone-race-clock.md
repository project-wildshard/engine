# The race clock under the minimap on a phone

> Written by: Claude (opus-gridparity, SHARD-SOURCE SS-MS1b follow-up), 2026-11-18

SS-MS1b's staging pass (v0.1.42) shot the finish on a 402 pt phone: the
clock chip, centred on the top row at 14 px, ran under the minimap, and
the finish read "0:58.8 · best 0:58." with the rest hidden. The phone's
top row is full (PAUSE, the minimap), so the boss and elite bars already
sit under the minimap, centred (`boss.css`). The race chip now takes
that row on a phone, at 13 px and never wider than the screen. Headless
Chromium at 402x874 and 375x667 put "10:58.8 · best 10:58.8" clear of
the minimap and inside the screen; desktop is unchanged.
