# Placement sweep (meta STAGING-BUGBASH SB45)

> Written by: Claude (opus-sb-pack2)

Uploads move staging's placement serial between releases and add Zone select cards no gate opens. `scripts/placement-sweep.mjs`
checks the serial on each main-watch pass (opted-in machines only, `~/.config/wildshard/placement-sweep`, so not the mini) and
sweeps each new or re-hashed slug with `zone-sweep.mjs --chunk`, one receipt line per slug. `--chunk` cold-loads
`/?chunk=<slug>&skipintro=1`, because a card tap enters the in-page grid and never ran the cold boot that OF8 broke (OF8b).
First real run: serial 32, mossgate in the world in 8804 ms by its cold link.
