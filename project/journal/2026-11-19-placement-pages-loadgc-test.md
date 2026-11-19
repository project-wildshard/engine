# 2026-11-19: placement-pages test counts IP31's slot read

> Written by: Claude (mini-pair)

`f30a7f02b` (IP31, mini-nine-loadgc) put `loadGc()` inside the placement page's parse slice. Its first call reads the
`debug.loadGc` device slot through `jsonSlot`, two `JSON.parse` calls of the empty store, then caches the answer for the
page. The read-ahead test spies on `JSON.parse` from a fresh module and wants exactly one parse, the page text, so it
counted three and main went red. The engine is right: a booted page reads the switch long before a placement page. The
test now reads the switch once before it starts spying. J389: the mini fixes its own red; that lane had exited, so
mini-pair took it.
