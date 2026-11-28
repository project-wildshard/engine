# 2026-11-27 An uncontrolled page no longer fetches its loaded code again (SF29)

On a page no service worker controls, the spawn download fetches the zone's code list into Cache Storage. The page's
module loader has by then read most of the same files. A headless WebKit phone boot with service workers off, counted
at a proxy, sent them twice: Pine 22 files (1.56 MB), Nalati 12 to 21 (0.55 to 1.46 MB).

The headers show why. The loader's request is a script request with an `Origin` header. The download's is a plain fetch
with none. Both answers are `public, max-age=31536000, immutable`, yet WebKit's HTTP cache answers a fetch only from a
fetch's entry: a fetch probe after boot hit for a file the download had fetched and missed for one only the loader read,
even with `cache: 'force-cache'`.

So the download asks first. On an uncontrolled page, a code file the page already holds (a resource timing entry for
its URL that no fetch made, `pageLoadedCode`) is credited as cached and not fetched or stored. The worker precaches it
once it controls a page (DL1), which keeps it off the level download. The rest of the code list downloads as before.

After, the same boot: Pine 0 files sent twice (code 5.46 to 3.99 MB), Nalati 2 (9.8 kB). Those two were the other order:
two optional startup chunks the download fetched before the loader imported them at control, which WebKit misses too.
So an uncontrolled page also leaves the boot bank's optional code (`#boot-module-files` `optional.files`) to its loader,
which imports what it needs on demand; the worker precaches the rest after control. Then Nalati sent 0 twice as well.

Guard: `test/spawn-download.test.ts` (an uncontrolled page never fetches a code file its loader read, never stores it,
and still completes; only a loader's entry counts, never a fetch's, another origin's or a content file's; the bank's
optional code is the loader's).
