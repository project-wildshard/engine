# Chromium ledger control follows the gameplay draw

> Written by: Codex

> **State:** 2026-11-21, J444 measurement fix.

Ink Cel Valley's control budget failed in hosted runs 44867929491,
44869801998 and 44908942546. The rerun 44870687459 passed using the same
CI client as 44867929491. The served Brotli digests match across all
four runs. All thirteen raw control checkpoints show 18,708,564 bytes
of textures. By the read after garbage collection, ten samples still
had about 18.7 MB and three had fallen to about 10.3 MB.

The loading card can disappear before the first draw after
`ws:control-ready`. That draw replaces Low graphics' full boot shadow
attachments with standby attachments. The old measurement took a
garbage collection as soon as the card went away, so the ordering
between the read and the draw decided which texture count it saw.

The Chromium ledger listens for the control-ready event and waits for
the same game to complete a draw before taking the existing garbage
collection and reading the ledger. The raw control checkpoint still
records the boot attachments. The measurement reads GPU formats and
the settled ledger together so an artifact shows the formats for the
bytes it judges. The game renderer and budget files are untouched.

The exact 6b92a8a0f pinned client from CI 44907025298 reproduced the
transition locally. The cascade went from 1024×1024 to 1×1 on draw
8, dropping 4,194,300 bytes each of RGBA8 and depth storage. Four
cold reads on the corrected probe kept 18,708,564 texture bytes in
the boot peak and read 10,319,968 at control. The four control totals
were 33,642,279, 33,378,083, 33,378,083 and 33,642,279 bytes against
the original 38,186,867-byte line.
