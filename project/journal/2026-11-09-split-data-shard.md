# SR11 (C10): a declared boss panel draws off its encounter row

`mountDeclaredUi` returned the Big Blob panel's bar and the page threw
it away: before the flip the page's own encounter drove it, and after it
nothing did. A declared panel now gets a `BossRowBar` on its encounter's
row, the one driver every native bar has had since J130: the name card
on the intro, the bar and phases in the fight, the retry card when the
fight arms again. The intro holds weapons as the native bars do, and
`boss.attempt` reports as theirs do.

C8 (declared kit melee) and C9 (the lantern and its oil) are not in this
commit. Both need the server to own declared item runtimes per player:
a data shard's player strikes with the zero-damage `HOST_PROBE` and an
aim-only attack has no target, and the lantern's lit state and oil are
owner-private, which only an owned line would carry. That is server work
and stays with SR11's Codex owner. No wire format change is needed: an
owned line is a name and a number.

Proof: `split-repair-proof --only=data-shard` (also `--play`), by
Template's hidden URL `?chunk=_template`: walk into the arena, see the
name card and bar, fall to the blob's real blows (about 35 s), see
"Try the big blob again, attempt 2". 3/3 Chromium and WebKit. The blob's
HP never moves, which is C8.
