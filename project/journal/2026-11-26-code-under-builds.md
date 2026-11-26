# A build's code moves to builds/<engineVersion>/<build>/

Fix-preview PV9, opus-pvpage. Jake asked for "folder per build but human readable
`builds/[engineVersion]/[build]/*`", so `codeDirectory` now writes `builds/0.1.97/<build>/` and
the J217 shared folder moved from `b/c/` to `builds/shared/` (my pick, reversible: J217 needs one
folder every build shares, and "c" read as nothing). Engine art stays under `assets/` by hash.

The runtime knows the engine version from the document's `__WS_CLIENT_VERSION__` (package.json's
version, the same field the folder is named by), so `boot/codeFolder.ts` builds the
`standalone/online.js` URLs without baking either half into a content-named chunk.

Every reader of a carried graph takes both layouts: deploys keep carrying builds from before PV9
under `b/` until they age out (KEEP_PROMOTED = 5), so previousDeploy, the service worker,
`_headers`, chunk recovery and the output walkers read `builds/` and `b/`. The writers write only
`builds/`. `codeLayout.mjs` is the guard: the build refuses a document loading code outside its own
folder or the shared one, a graph naming `b/`, or a page of 20,000 files.
