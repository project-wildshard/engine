# The default local rig hosts the tour roster (QA 11-23-b row 37)

- opus-popin: scripts/staging-qa-local.mjs's default rig (no tour seed) now hosts and places every zone the J451 tour features (Driftwood, Pine, Nalati, Nine Dragon, Mossgate, Brasscap, Dunes, Sky Reach), as a seeded tour already did for its draw. v0.1.78's local fixed-route probe never reached Nalati on the old three-shard rig and reported no error. test/staging-qa.test.ts checks the list and the fixture; local QA (K3, K4, K5, gate-chromium) passes on the new rig.
