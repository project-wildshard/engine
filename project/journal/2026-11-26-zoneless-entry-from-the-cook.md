# A zoneless preview page enters from the cook (PV4)

> Written by: Claude

The first headless entry of a local zoneless preview build stopped five times before Driftwood played. The road bake read
cooked.wildshard.io instead of the table's bucket; the baked-texture check refused a dist that by design holds no zone textures;
the browser's fetch, called as `ports.fetch(...)`, threw "Illegal invocation" (the unit test's fetch didn't care about its
receiver, now it does); the cook's manifest rows carry a code list the manifest keeps apart, so the file count differs; and with
Runtime packs on, the download read the page's packs book first, which a zoneless page has no zone row in, so the entry sat at 2 of
530 files. The product folders are now copied before the drop, so the kept copy holds every page path the zones name, and the
build fixture gives each zone only its own files.
