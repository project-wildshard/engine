# Engine art is engine git's (SF11 slice)

Lane opus-public, meta standalone shardfiles SF11 (J525). Building SF11
(pins publish nothing under `public/`) ahead showed two files on the engine
list (`src/scripts/public-engine.json`, SF1) that reached `public/` only
because a pin published them: the baked cloud field (Nalati's mount) and
the water ripples. Every zone reads both (`bakedUrls.ts`), so once pins
stop publishing, every page would lose its clouds and water ripples.

They are tracked engine files now (256 KB each, the bytes the pins carry,
so today's installs verify them as engine files instead of writing them),
and `.gitignore` stops naming them. `test/engine-art-tracked.test.ts`
fails if any file on the engine list is not in engine git (the Basis
transcoder excepted: the build copies it from its package). The rest of
SF11 stays a patch until every build is zoneless.
