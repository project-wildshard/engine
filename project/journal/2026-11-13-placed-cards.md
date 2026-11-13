# 2026-11-13: a placed slug the build lacks gets its card from the catalogue (SA46)

> Written by: Claude

`13eca0f0` taught a released page the cells the API placed after its build, but a slug the build has no title row for (a new
author's upload) stayed out: the page knew only its baked cards, and the API sent no CORS. api-server v0.15.0 now answers the
three game origins on its catalogue GETs and serves one row at `GET /api/catalogue/shards/<slug>`. After the build's own placed
cells are installed, `placedCards.ts` asks for each slug the build lacks (at most four, its own 1.5 s deadline inside the file's
3 s, `no-store`, no credentials) and adds a plain row (`catalogueTitleRow`: the entry's name, the plain art, last in the deck);
then the cell goes in like any other. A 404, 500, offline, no CORS, junk, another slug's entry, a bad name or a hung API leaves
the slug out, and never costs the cells the build already cards. The API hosts no uploaded shard's images, so the card is plain.

Found by the local proof: a browser's `fetch` called as `ports.fetch(...)` throws Illegal invocation (the tests' fake did not
care), so the port is called bare and the test's fake now refuses a `this`. Proof: a local build with Thin Ice stripped from its
title rows and inline catalogue read the live staging placement file and the live API entry (its CORS answer for staging's
origin: `https://staging.wildshard.io`), carded "Open Plot · Thin Ice", ENTER WORLD → inside `open-plot-thin-ice` (0,3), walked
17.5 m desktop and 29.1 m phone. Entering works there only because the build hosts Thin Ice's product: a new author's product
is hosted nowhere a page reads yet.
