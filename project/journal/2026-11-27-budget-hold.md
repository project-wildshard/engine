# 2026-11-27 A budget hold for a zone past its hard cap (J381), and CI judges it too

Since SF11 a zone's phone whole set lists its own mounts, which a phone used to fetch from `public/` uncounted, so the
gate now reads Pine r19 at about 142 MB and Nalati r12 at about 125 MB, past J338's 100 MB hard cap; a WebKit phone boot
fetches within 2 MB of those numbers. It is not new growth: the old 49 MB and 81 MB baselines were undercounts. Content
is never cut to fit (J439) and the cap moves only on Jake's word, but a red `build:game` blocks every lane.

J381's escape hatch: `budgets/baselines.json` `holds` names a budget key, the content key it holds, the plan row it waits
on and why. The verdict marks that row HELD instead of OVER HARD, the gate and the budgets table print it, and a new
revision or another zone is judged again. `fileErrors` refuses a hold that names no plan row. Pine's hold waits on Jake
(meta standalone SF27: it fetches about 120 MB once each image is counted once). Nalati's waits on SF28, which counts
each texture blob's image once (a phone reads the image, not its KTX2) and brings Nalati to about 91 MB.

CI's full pinned build (`memory-client-build`) never ran this gate: `build-app.mjs` judges only the default `dist`, and
CI builds into `tmp/memory-ledger/preview/dist`, so CI stayed green while a local `build:game` failed. The job now runs
the same `--hard-only` gate on its output. Guard: `test/budget-hold.test.ts`.
