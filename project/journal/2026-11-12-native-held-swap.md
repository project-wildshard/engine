# A native kit's swap reaches the server (SERVER-PARITY HS8, opus-slotsync)

- RP5 found it: on Driftwood and Nalati a page's switch of held item never reached the server. `NetPlayer` sent swaps by
  its slot map, and a native kit has none, so `equip(row)` returned; Driftwood's swept kit had no equip route; and neither
  Driftwood's swords nor Nalati's held arms wrote the row's `held`. Others saw the starting item whatever you held.
- One numbering now: `kitSlots` (net/heldOnOthers.ts) is the slot map, or a native kit's order (`EquipmentService.kitRows`,
  the kit's `order` or else its list), which is the server's slot order. Sending, following the server and drawing others'
  hands all go through it.
- Server: the swept kit takes `actRoutes.equip` when no loadout has it, refuses (counts) a slot past the kit, and writes
  `held` only while it holds the route. Nalati's `held.arms` writes `held` as `order.indexOf(slot)`.
- Ownership: Driftwood's swept selection says both swords are owned (`ownership: [null, null]`); the iron sword's real
  owner is the quest (`gear.state.iron`). The quest now lends the kit that rule (`owns`), so a fresh page asking for the
  iron sword is refused and follows the server back to the wooden one. Nalati's three arms are every player's.
- Proof: `test/net-remote-held-swap.test.ts` (dedicated room, two seats) and `net-held-wire.test.ts` (a page's NetPlayer);
  `scripts/remote-held-proof.mjs` swaps Nalati's bow to sabre and back live; Driftwood's and Pine's swaps skip there,
  since a fresh Jimmy owns neither the iron sword nor the longbow.
