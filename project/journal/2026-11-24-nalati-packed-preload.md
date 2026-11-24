# Nalati entry stops at Final activation (QA 11-23-b row 34)

- opus-popin: every grid entry into Nalati Grasslands stopped on the error card "Packed creature bodies are not loaded" at stage finish (the smoke's "gap after Final activation" hold on staging z2/z3, and on a local rig). Nalati's packed looks (OF30g1, no hull book) had no preload, so `AnimalFactory.ready` waited on nothing and a herd built before the bake was read. Each packed look now preloads the bake it copies from, and a failed bake read is read again on the next preload instead of being kept as a rejection.
