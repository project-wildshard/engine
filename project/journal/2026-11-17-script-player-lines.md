> Written by: Claude
> State: done, 2026-11-17.

SHARD-SOURCE SS-GF1a2: a script's own player field reaches its page. The server
publishes every non-host numeric player field that no item projects as that
player's owned line (`script.player-fields`), read from the script world's view
of that player; the standalone page reads those lines as it reads an item's
projected field, so a panel shown by a player field (a socket this player lit)
shows on the page. Grid copies still read a player field at its default.
