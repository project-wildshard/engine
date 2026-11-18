# 2026-11-18: a boss starts placed, spawned or resident (ONE-FORMAT OF34b)

opus-pin. Format 0.40.0 carries OF34a's boss fields, so the declared encounter now reads them. `spawned` keeps the body
out of the world (hidden, not alive, under every floor, as an absent `when` spawn) while the fight is armed and stands it
at home when a player enters the arena; a reset puts it away again. `resident` ignores the arena: the first player blow
on the body arms the intro (the blow itself is refused, as any blow outside the fight is). `capExempt` sets the body's
own cap exemption, the same flag a species row sets. `room` bounds reset the fight once nobody is inside, now for a lone
player too; `open` bounds reset it once the body is drawn past the radius and walk it home. A resident or open-ground
boss counts its contenders near its body, not the arena's middle. Rows without the fields read exactly as before.
