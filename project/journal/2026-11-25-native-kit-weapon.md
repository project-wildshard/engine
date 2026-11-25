# Driftwood's native swords are found in the kit again

> Written by: Claude (lane opus-fp54b), FORMAT-PRUNE FP57

Driftwood's republish on staging v0.1.89 timed out in `wildshard prepare` three times: the recorder never entered. On the
same preparation client, the page stopped at `level.play` with "Item effect weapon weapon.driftwood-isle.wood is not in
the kit". Driftwood's swords are `row: 'native'` runtime owners, and a native owner keeps its native row and id (`sword`,
row `weapon.sword`). The lookup from 3c9b5870b tried the item's row (`weapon.driftwood-isle.wood`) and the declared id
(`declared.weapon.sword`), and neither names a native owner.

`kitWeaponOf` now tries the equipment row the item wears last, and a unit test keeps the three ways and the refusal.
Proof: a preparation client built from this tree records Driftwood (85 programs, 161 shaders) where v0.1.89's timed out.
