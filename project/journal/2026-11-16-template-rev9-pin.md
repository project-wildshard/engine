# 2026-11-16: Template rev 9 pinned (TC-SHIP-b)

> Written by: Claude (opus-brassgun14)

Meta TEMPLATE-E2E TC-SHIP-b. Template rev 9 (`6016f170`, sharddev
`219f23a`) brings the Barrow Warden into the sword's reach: its body sits
at bodyY 0.85, radius 0.75, so the server kit's aim point is within the
sword's 2.2 m range. `shard-pin.yml` made `plan/pin-template-r9`; its CI
was red on two pinned records, and the pin is folded into this branch
(`scripts/pin-shard.ts template 9 … staging`) so one land carries it.

- `test/pins/saves/template.json`: the released v0.1.1 save is refused
  whole by the newest pinned head, now rev 9.
- `test/pins/ring-digests.json`: Ring 1 cooks `template` from its pin, so
  its digest chain moves with the product (and with TC-NE24c's brain
  state). Recorded on darwin-arm64 with `ring-step.ts --update`; the
  linux-x64 row CI compares is copied from it. Every other Ring 1 row is
  identical across the two platforms, and template's was too before this
  branch, so CI's compare checks the copy.
