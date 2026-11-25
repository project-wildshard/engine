# Soft lines for Glowfen r8 and Nine r11 (meta QA 11-25 row 68 j)

- opus-fp54c: budgets run 45684953784 (engine 3ae235c82) is the first green with a result since Nine r11: the phone
  sweep's 30 s frame wait had failed every run until c173c0039 made it a 180 s hang guard (row 55). Recorded with
  `node scripts/budgets/cli.mjs record --run 45684953784 --why …` (J439, J444): Glowfen r8's first lines
  (download/phone 6.49 MB, phone Low 77,677 triangles), Nine r11 (phone Low 634,477 triangles, download/phone
  28.54 MB), and the other pins on that commit (Pine r18, Nalati r10, Driftwood r12). Driftwood r13 records from
  the first green run on 9a5101633 or later.
