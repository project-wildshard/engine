# Census the actual title and grid against pins

Written by: Codex. 2026-11-08. EG-20, J186.

Build all twenty-eight real pinned products with the production catalogue
input. Inspect the shipped HTML and fetched catalogue, require identical
first-paint data, all pinned title/head/placement rows and exact immutable
head hashes. Grid cells match the pinned catalogue's declared cells: three
solo products have no grid cell, so there are twenty-five, not an exception
list. The complete build takes nineteen seconds and belongs in Ring 2.

The checker refused the actual default tree catalogue, whose reconstructed
tar hashes differ from the immutable pin revisions. Building with the
production pinned catalogue passes: twenty-eight title, head and placement
rows and twenty-five declared cells. The nightly/manual report runs that
whole path. No rendering or page layout changes are made.
