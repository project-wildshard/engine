# The cook keeps its texture encodes across jobs (SF21)

Lane opus-public, meta standalone shardfiles SF21. A cook job kept no
texture encodes, so every killed or repeated cook of a big zone encoded
everything again. Pine's images-only cook spent about 1500 s in its
textures phase on each try and ran out of the 1500 s job clock (SF5d).

Both encoders (`imageKtx2Wasm.ts` for the desktop UASTC, `astc6Wasm.ts`
for the phone's 6x6) now keep each output in the job's surviving cache
folder. `cookWorker.ts` passes `COOK_ENCODE_CACHE` and grants the child
that folder; `zone-cook-entry.mjs` keeps `<out>/.encode-cache` across its
runs. `encodeCache.ts` holds the key and the check.

The key covers the encoder and its tier, the basisu build, the encode
settings, the role, the flip and the cook version, plus the input bytes.
A changed setting or a cook change misses the cache, so a fix like the
coat fix never serves a stale KTX2. A hit is used only when it is a whole
KTX2: its identifier, and every level inside the file. A torn file is
encoded again and replaced.

`test/cook-encode-cache.test.ts` checks that every key part and the cook
version change the key. It also checks that a reuse counts as reused, that
a changed role or flip misses, and that a torn file is encoded again. It
ends with two real permission-limited cook jobs, where the second reads
the first job's encode. The golden cook's output is unchanged, so the
record names the previous hash as the same output.

The cook version is imported (`with {type: 'json'}`), not read by
`new URL(..., import.meta.url)`: sharddev's author bundle inlines such a
URL as a data: URL, which `readFileSync` refuses, so a load-time read
broke every `wildshard dev` (found by opus-sdk before this landed). The
test fails on any cook or shared module that reads a file that way when
it loads.
