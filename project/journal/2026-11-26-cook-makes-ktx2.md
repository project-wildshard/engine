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

## Slice: GLB images

A GLB mount holding PNG or JPEG images now cooks to a GLB whose images are
KTX2 under `KHR_texture_basisu`, each with the role of the material slot
that samples it (`glbImageRoles`: colour over normal over data). Buffer 0
is rebuilt in its own order on 16-byte steps, every other byte kept; a GLB
whose ranges partly overlap, or whose image view an accessor also reads, is
left alone. The phone pass then trims it to 512 and writes 6x6, as for any
KTX2 GLB. Cook 1.2.0.

## Slice: textures named by hash (SF16)

Many of a shard's textures are product blobs named by hash: a look's
material maps, prop material slots, `props.textures` and the splat
ground's layers. The page admits those by hash, so the cook can't swap
their bytes. `blobKtx2.ts` reads each blob's role from the rule that names
it (`blobTextureUses`), encodes each PNG or JPEG one unflipped to
`/assets/<folder>/blobs/<hash>-<hash8>.ktx2`, and names it in both tiers
of the table under the blob's URL (`#layer` added for a splat layer). The
phone pass then makes the 6x6 copy, trimmed to 512 except a layer.

The client reads that file in the blob's place when it loads KTX2
(`blobGpuFile`, `splatLayerFile` on either tier for an image layer), and
decodes the image itself when it doesn't (`blobTextures.ts`). A KTX2 blob,
as every hand-made set is, reads as before. The desktop still admits an
image splat layer's blob as well as its KTX2: the format's skip rule
(`cookedSplatLayers`) only drops phone layers. Cook 1.3.0.

## Encoder lanes bounded by memory

Pine Hollow's images-only cook died past its job's 6 GB in the textures
phase. Measured: a 2048 UASTC encode grows a worker's WebAssembly heap by
about 230 MB, a 2048 ASTC 6x6 encode by about 1.9 GB, and a heap never
shrinks. So three 6x6 lanes on Pine's kept 2048 rows (skies, panoramas,
splat layers) passed 6 GB. Both pools now run through `encodeLanes.ts`:
largest job first, a lane takes a job only while every lane's held heap
stays within `COOK_ENCODE_MB` (4 GB by default), a job above it runs alone,
and a lane that ran a job above 512 MB is ended so the next starts small.
Same output: cook 1.3.0 records it as such.

## Texture bytes are decoded by their magic

SF16 sent every non-KTX2 texture to the image decoder, so a test fixture
of made-up bytes standing in for KTX2 reached `createImageBitmap`, which
Node lacks, and main went red (run 45924093166). The page now decodes by
magic (`textureKind`: KTX2, PNG or JPEG) and refuses anything else by
name, and `test/helpers/ktx2Fixture.ts` is the shared KTX2 stand-in.

## Skin maps, posed atlases and lossless data maps (SF17)

Pine's creature skin maps and bird atlases and Dunes' sand maps were KTX2
blobs no rule encoded. Now every PNG or JPEG blob cooks: a skin look's
textures (format `skinLookTextureRefs`) and any blob no rule names (a
posed atlas) as sRGB UASTC. The ground's grain, trail and key-shadow maps
are data by rule: `dataKtx2.ts` decodes the PNG and writes the single-level
zstd R8 or RGBA8 KTX2 Dunes' `rawKtx2` made by hand, texels identical,
keyed `<blob URL>#data` so a page reads it in either texture mode. A PNG
posed atlas reads the table's KTX2 by its URL or decodes the image. No new
format field was needed. Cook 1.6.0.
