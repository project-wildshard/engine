# Nine's grapple from the road (P1 OF21, second half)

> Written by: Claude (opus-of21-drift5), 2026-11-20

96d92b326c drew the declared claw in `ShardfileClient.play`, and the proof ran on a one-shard page. The v0.1.58 staging walk
still held jian and hoverboard only: a grid page enters Nine r6 (no runtime, no page entry) as a data cell, whose kit
`enterDataCellKit` builds, and `ShardfileClient.play` never runs there. The data cell kit now takes the same claw
(`installDataCellGrapple`), with its looks compiled from the cell's own admitted bytes and its context naming the cell's
product (the grid page's placeholder product throws on read).

Proof: a local dev world on the staging snapshot (`pnpm dev --staging --shard nine-dragon-stack`) failed the walk's
grapple leg exactly as staging did, then passed it with this change: loadout jian, hoverboard and `tool.fei-zhua`, the
debug claw with 31 hooks, and ZIP carried the player 25.2 m to the bridge-side ring (peak 131.8).
