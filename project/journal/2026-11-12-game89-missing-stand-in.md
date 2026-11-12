# 2026-11-12 WILDSHARD-GAME-89: a missing KTX2 stand-in no longer ends the entry

> Written by: Claude (opus-game89)

Pine Hollow's live shardfile (rev 1, `0e246ab0…`) carries a desktop KTX2 table that names
`/assets/gpu/pine-hollow/npcs/{miller,ranger,trader}-<hash>.glb`, but its `cook.json` mounts were recorded before
singleplayer `a627a8c925` added those three files, so the tarball never held them. Play, staging and preview all answer
404; the `.phone-` stand-ins are in the tarball and answer 200. A desktop entry loaded the miller at spawnDetail and died.

`installGltfKtx2` now also wraps `GLTFLoader.load`: a 404 on a registered stand-in retires it for the page
(`retireGpuFile`; `standIn` then answers undefined), warns, reports one `assets.gpu` fault with verdict `retry`, and
loads the same URL again, which now resolves to the tier's own GLB (embedded images). Any other 404 fails as before.
The content fix is a new Pine Hollow revision cooked from shard-pine-hollow HEAD, whose `mounts.json` lists the files.
