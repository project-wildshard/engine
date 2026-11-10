# Staging signs packs-first

> Written by: Claude

Jake ran the connection doctor on staging at 11:52 Cancún and got a
half-open world. The page was `a8144a5`. The signed staging file was
serial 63, `b721769`, which server-release run 42854431977 had signed at
11:26 after that commit's CI and Ring 1 went green. The packs origin had
no server book for `b721769`, so the packs check failed. The server was
still on `a8144a5` at serial 44, and the doctor said it "moves by itself
within a few minutes". It could not: the server's release watch loads
the new build's book and parts before the grace, the book is 404, so
every poll fails and it stays where it is. It had been there since
06:49, through nineteen staging serials. Only the builds whose staging
page was published by hand (`e5c315e`, `6fce8c2`, `a8144a5`) have books.

Jake, 11:58: "staging needs to be healthy. we can't show these
half-assed, half-open, half-closed failure states."

The producer signed whatever main CI turned green, and the page and pack
publish came separately, by hand. Now `publish.mjs` checks the book and
every part the pinned shards and the grid need before signing staging,
and reports `held` when they're missing. The channel keeps naming the
last build the server can actually play. A `workflow_dispatch` with
`build=<sha>` signs a named green build whose packs are published, newer
or older, from main's own tooling and the tag's existing bundle. That's
how a held build goes live once its packs land, and how staging rolls
back. Production is unchanged and can't be aligned.

The doctor also misreported join. It printed the release's build, but it
had sent the page's build in its hello, and the door seats only its own
build. So "accepted · build b721769" really meant the server ran
`a8144a5`. Join now names the build it sent. The server row says it's
stuck when the release's packs are missing, and otherwise says to check
again in a few minutes. The packs row names the build it asked for.

The doctor change ships in its own commit, with a regression test where
the release names a build with no book: packs fail with the build named,
the server warns stuck, and join names the build the server runs.
