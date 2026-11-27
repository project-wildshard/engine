# 2026-11-27 The phone finds a file by its own name, and reads the trimmed layer (SF5d, SF5g)

Pine Hollow 0.0.18's cooked phone entry failed with "the world didn't download": the slab's `loadPBR` asked
`rock_ground/arm.jpg` on the phone, but the cook had keyed that file's phone row only by its `arm.phone.webp` copy, so the
page answered 404. `phoneKeys` now adds the file's own name whenever the phone serves a copy. The phone also read a ground
layer's whole twin (`#layer`), so Pine's nine 2048 ground maps reached a phone at 2048, past desktop's 1024 and the 1k of
its hand-made phone sets; the phone now reads the trimmed one desktop does. test/cooked-ktx2-phone-keys fails on the old
cook and passes now. Cook 1.15.0, recorded over the cook closure without other lanes' unstaged encoder edits.
