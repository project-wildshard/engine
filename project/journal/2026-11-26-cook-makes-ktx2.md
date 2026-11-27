# The cook makes every KTX2 (SF15)

Lane opus-cookktx2, meta standalone shardfiles SF15 (J525). A shardfile
carries one image per texture from now on, and the cook encodes the KTX2.
First the shape other lanes read: the KTX2 table the cooked index carries
(`src/shared/game/shardfile/cookedKtx2Table.ts`), per tier a source URL to
the cook's file, so the index writer and the client build against it now.

## Slice: image mounts and ground layers

The cook now encodes every `/assets/` PNG or JPEG mount on the 4x4 grid
to a desktop KTX2 (`cookedKtx2.ts`, `imageKtx2Wasm.ts`) and hands it to the
phone pass, which trims it to 512 and writes ASTC 6x6 as before. The
settings are the hand-made sets' own (sharddev `bake-ktx2.mjs`): UASTC
level 2, no RDO, zstd 20, box mips; sRGB transfer for colour, linear for
normal and data; a standalone image Y-flipped, a glTF folder's textures
and lightmaps not. A ground layer (`tex/<set>/diffuse|nor_gl|arm.jpg`)
also gets its unflipped `#layer` twin at 1024, and a phone row under its
`_1k` name because the phone's `texUrl` asks for it.

One pick differs: data planes (ARM, roughness) are UASTC linear, not
ETC1S. They look at least as good and the phone can trim them, at about
five times the bytes of an ETC1S plane. WebP is not encoded: basisu reads
PNG and JPEG only, so a WebP stays an image. A mount marked `keepImage`
and an image the table already names (an old shard's hand-made set) keep
their bytes, so old shards cook as they did.

`src/scripts/ktx2-look.ts` is the look check the re-pack lanes run before
deleting a hand-made set: per texture it decodes the hand-made and the
cooked KTX2 beside the source and sorts by PSNR, worst first.
