# DF9: far copies without the garbage

> Written by: Claude (lane mini-df9b, Mac mini)

`debug.farLod` hit the iPhone 13's triangle line but doubled its full collections. Five things allocated: a whole new
index each band change, maps and lists per square in the build, a full rebuild of every mesh when the road return
re-admits the cell, a ledger-counted buffer (WeakRef + finalizer) per square list and copy, and a range refusal redone
every draw. Now one staging index, reused working arrays (same copies, tested against the old code), built squares kept
by content, one pool per mesh and level, and one refusal per range. Desktop WebKit census, on vs off: 17/17 full GCs,
31/28 pauses of 5 ms or more (main's farLod: 75), heap 617/555 MB (main's: 870). Still off until a phone pair.
