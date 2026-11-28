# 2026-11-27 A phone's sets list a cooked image mount as its KTX2 alone

engine@719ceebac made the home-baked build list a zone's mounts as its cook does, and the shard-size gate then read
Pine's phone download as 165.0 MB and Nalati's as 131.6 MB, past J338's 100 MB hard cap, so every `build:game` failed.
Part of that was honest (the mounts used to be served from `public/` and counted nowhere), but the phone lists also
carried each cooked image mount twice: the image beside its phone 6x6 KTX2, and the whole download fetches every listed
file. A phone samples the KTX2 and never reads the image; SF25 already charges the load estimate so.

`shardHalf`'s `tiered` now leaves an image mount out of a phone set when the set carries its KTX2, except where a reader
fetches the image raw: the zone's own far impostor (the grid's far ring decodes the PNG; with it unlisted `bakedFile`
fell back to the engine-wide copy SF12 removed, a 404 in the first WebKit run) and a `.gltf` mount's textures (its loader
fetches each URI). A listed glTF now brings the images it names into the same phone set, beside any 6x6 file the phone
tier made of them: Pine's fence recorded its props' `.gltf` documents alone, and a WebKit boot fetched 15 of their
textures from the page, outside any part. The desktop keeps
every image for a GPU that can't sample KTX2.

Texture blobs keep their images on the phone. A first cut dropped them too, but a WebKit phone boot of Pine still fetched
53 blob images raw (UI compendium and level art, glTF dependencies): the cook gives every blob image a KTX2 (SF17's
default role) whether or not its reader goes through the table. That double is the other way round, an unread KTX2, and
is a follow-up row. Cook 1.20.0. Guard: `test/phone-ktx2-not-source.test.ts`, which fails without the change.
