# LD6: code survives a deploy (J217)

Every chunk lived under its build's `/b/<build>/` folder, and the dynamic-import maps named that folder,
so only ~20 % of code bytes kept their URL between builds a few commits apart and each deploy
re-downloaded the rest (Jake's phone: the 962 kB server worker over 4G, 2.5 s). J217: entries and the
document stay in the build folder; non-entry chunks, CSS and wasm are content-named under one
shared `/b/c/`. The deploy carry (MF2, J79) already keeps every kept build's graph; it now scans
the shared folder too, so an old tab still finds each file it names, and a file both builds name
is held once. `test/previous-deploy.test.ts` proves it. Plan: meta
`docs/plans/LOADING-DIAGNOSTICS-PLAN.md` LD6.

Workers too: Vite named each module worker in the build folder, and every chunk that starts one
held that URL, so even a rebuild of the same tree renamed most of the code. Workers are now
content-named in `/b/c/`: two builds of one tree keep 100 % of code bytes at the same URL (131 of
133 files; the two that move are the entry and the calibration entry). A one-line source change
keeps 31.7 %: each chunk names its imports by hash, so a change renames every importer. The
own-content of 86 % of bytes is unchanged there; only an import map (rolldown's
`experimental.chunkImportMap`) would keep those URLs, which is LD6b.
