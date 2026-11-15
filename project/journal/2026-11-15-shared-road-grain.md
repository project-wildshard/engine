# Ring-first road halves share their deck grain

> Written by: Codex

PZ24c extends the existing counted road-map share to the identical deck
array. The first half paints/uploads it; later halves borrow the same
texture and admit no duplicate texture bytes. The last owner disposes
it. This removes one 1,747,620-byte mip chain on the phone grid without
changing its pixels, shader, sampler or geometry.

Four focused tests, lint and typecheck passed. The integration check
builds both halves with a real shared DataArrayTexture, retires the
original owner and first half, and verifies only the final half frees
it. Memory measurement and all-six Chromium/WebKit goldens are still
owed before the plan's single land. PZ24's 38 MiB target stays open.
