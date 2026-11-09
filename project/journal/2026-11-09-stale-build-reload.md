# An old cached build reloads into the live one

The old cached build on his phone sat at 0.00 MB. A deploy keeps only
the live build's hashed files, so the old spawn manifest is a 404, and
readContent waited on the card's RETRY forever. A missing file now
checks version.json. If the server names another build, the page puts
the cover up and reloads past its worker into the live build, once per
build and tab. A missing file on the live build keeps the ordinary
RETRY.

Tests: a stale 404 reloads once with the cover; a 404 on the live build
keeps the RETRY.
