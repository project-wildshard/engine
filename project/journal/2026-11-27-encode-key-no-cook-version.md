# Encode keys drop the cook version (QA 11-26 row 31)

Lane opus-public. CI's memory-client-build ran out of its 30 minutes in
"Build every production pin" (run 45952914915, 29.6 min, silent after the
title preloads, in the app cook's texture encodes) and blocked v0.1.99.
With a warm encode cache that step takes 1.3 to 1.7 min; after an encoder
edit it took 9 to 11 min.

The cause was SF21: it put the cook version into every texture encode key.
The cook version moved from 1.11 to 1.14 in a few hours, and each bump
emptied every phone and desktop encode cache. The new key format also
missed every cache made before SF21 (nightly, full ledger, local), so CI
encoded all 27 pins from cold, and the job saves its cache only on
success, so a retry started from nothing again.

The keys are now the pre-SF21 ones byte for byte: the encoder and its
revision, basisu's build, the settings, the role and flip, then the input
bytes. Those decide the encoder's output; an encoder change bumps its
revision or settings, and the cook record still hashes the cook. The
memory build also saves its encode cache under a per-run key when its
build step fails or times out, so a cold run gets further each try.

Guards: `test/cook-encode-cache.test.ts` pins the key to the pre-SF21
format on a fixed input and fails if an encoder reads the cook record.
