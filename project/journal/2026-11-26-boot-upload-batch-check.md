# Boot upload batch check (QA 11-25 row 151, opus-boot151)

> Written by: Claude. State 2026-11-26: work in progress on plan/boot151.

The grid boot draws frames under its loading card, so `presenting()` is true and compressed uploads skipped
their `getError` read: a refused upload there was a blank texture nobody heard of. Under a card that covers the
world, uploads queued back to back are now one batch with a drain as it opens and one read as it closes (at most
16 uploads a read), naming the batch's last texture. The boot trace runs only on traced phone boots, so the batch
follows the loading card (`holdLoadingUploadChecks`), not the trace.

The drill showed the first world upload under Nine's card is the optional road surface map, whose refusal fell back
to the procedural maps silently; it now warns with the refusal. Next: the nine-dragon texture drill has to inject
into a world texture past the road maps (sRGB ASTC 6x6 is 37844), then measure the WebKit 402x874 boot cost.
