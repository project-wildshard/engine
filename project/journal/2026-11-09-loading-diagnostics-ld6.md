# LD6: code survives a deploy (J217)

Every chunk lived under its build's `/b/<build>/` folder, and the dynamic-import maps named that folder,
so only ~20 % of code bytes kept their URL between builds a few commits apart and each deploy
re-downloaded the rest (Jake's phone: the 962 kB server worker over 4G, 2.5 s). J217: entries and the
document stay in the build folder; non-entry chunks, CSS and wasm are content-named under one
shared `/b/c/`. The deploy carry (MF2, J79) already keeps every kept build's graph; it now scans
the shared folder too, so an old tab still finds each file it names, and a file both builds name
is held once. `test/previous-deploy.test.ts` proves it. Plan: meta
`docs/plans/LOADING-DIAGNOSTICS-PLAN.md` LD6.
