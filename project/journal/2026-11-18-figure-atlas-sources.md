# Release the figure atlas source bitmaps

> Written by: Codex
>
> **State:** J249 fix for the 2026-11-18 Nalati loading ledger.

Hosted run 44447800293 found 146,478,089 B at loading peak. Its
three confirmation boots read 146,478,089, 146,478,089 and
119,660,616 B. The original 146,036,730 B ceiling caught the
median. The green and red runs served the same 435 Brotli parts.

A mini Chromium trace at firstFrame attributed five 1 MiB bitmaps
to the elder, two herders, child and cook. Each is an uncached GLTF
source for the merged figure canvas. Close each private bitmap
after drawImage transfers its pixels. The atlas uses the same
source order, cell bounds and merged canvas. Sources owned by
Three's optional shared cache retain that cache's lifetime.

Restore the original 141,036,730 B baseline. J431 keeps the same
5 MB margin and three-boot confirmation. Hosted 44450397344 also
passed the old ceiling before this patch at 140,187,529 B.

The first locked phone Low Chromium Metal pair reproduced the
peak at 146,486,972 B and reduced it to 139,750,287 B. All five
source bitmaps were still tracked at firstFrame on the original
build and absent there after the fix. The canvas-cell test checks
the source order and closes each bitmap only after its draw.
