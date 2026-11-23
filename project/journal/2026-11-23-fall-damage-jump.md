# Fall damage: a jump never hurts

> Written by: Claude (lane opus-prune1)

QA 2026-11-23-b row 12 (Jake, staging v0.1.74, iPhone 17 Pro): "you should not take damage on a jump". A hard landing
was any touchdown faster than 9 m/s, but a double jump on flat ground lands at about 11.5 m/s (apex about 3.0 m), so
the best double jump hurt. The threshold is now derived from the jump law: the highest single plus double jump
(`MAX_JUMP_APEX`), landing on ground as far below the take-off as that (`SAFE_FALL`, about 6 m), plus one 30 fps
step of gravity, about 17 m/s. A jump on flat ground or off a ledge no higher than a jump deals nothing at 30 and 60
fps; a 12 m fall still hurts. Client and headless host share the rule (`hardLanding`).
