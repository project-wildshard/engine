# The held item on other players (REMOTE-PLAYERS RP5)

- Jake, 17:43: "they need a sword ... I don't see his sword and stuff". Every other player held one grey box blade,
  whatever their row's `held` slot said. They now hold the item itself, in the castaway's `hand.R` (a bow in `hand.L`).
- No new models: `net/heldOnOthers.ts` takes the page's own first-person model of the item (`EquipmentService.heldLook`)
  and keeps its shown, solid, unskinned meshes (not the arms, the fp hands, sleeves and nocked arrow, a trail ribbon, a
  glow card or a depth-only part). It copies them once per kit (the view bends the longbow's stave in place and fades the
  crossbow while aiming), opaque; every body clones that one prop. A new kit (a crossing's `bindSlots`) frees the copies
  and every hand retakes its item. `drop()` lets go before the body is freed; the first-person item is never touched.
- The longbow's fist, sleeves and nocked arrow are now named (`heldLauncher.ts`) so the copy leaves them off.
- Grip: a part on a rig bone (Driftwood's `R_weapon`) sits on the hand as on that bone; a loose part as in its item
  (`declaredSword.ts`: grip at the origin, +y up the blade). An item whose origin is off it (Nalati's sabre is placed as
  the camera holds it) is turned so its length runs up +y and held 10 cm up from its near end.
- Slot to row: `NetPlayer`'s slot map (kit melee, levers, ranged), the same one the page follows the server by. A native
  kit with no map (Driftwood's swords, Nalati's bow, sabre and spear) goes by the kit's `order`, else the list's.
- The registry sits on `globalThis` (as `othersOnMap.ts`), since otherPlayers.ts is in the online bundle.
- Found, not fixed (not RP5's): on a native kit (Driftwood, Nalati) a page's swap never reaches the server: `NetPlayer`
  has no slot for the row, so the row holds the starting item whatever the page holds. Pine Hollow's kit has slots, but
  its longbow and lever are a quest's and a rack's: a fresh player owns only the crossbow, and the server refuses the swap.
  So the swap is proved in `other-player-held.test.ts`, and live only once a room lets a fresh player swap.
- Proof `scripts/remote-held-proof.mjs`: Driftwood (Jimmy's sword in his right hand) and Pine Hollow (his crossbow), each
  item Jake's own first-person geometry, 0.25 to 1.8 m long, off the ground, nothing else held; the longbow swap is tried
  and skipped with the server's slot while it refuses.
