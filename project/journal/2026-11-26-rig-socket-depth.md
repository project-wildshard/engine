# v0.1.94's local QA socket ran past the Unix path limit (opus-rel86, QA 11-25 row 88 follow-up)

- v0.1.94 was the first train to run local QA from its own clone (row 88, `485c860a7`). The clone sits in the train's
  scratch, so the rig's PGlite socket, `<clone>/tmp/<lane>/qa-<id>/local/rig/pg.sock`, ran to about 120 bytes. macOS
  holds 103 (104 with the NUL), and listen failed EINVAL two minutes into the train. From the canonical checkout the
  same path was about 88 bytes, which is why no train met it before.
- `rigSocketPath` (src/scripts/online-rig-options.mjs) keeps the socket in the work folder when it fits and otherwise
  names a short one in the OS temp folder by the work folder's hash. Only the rig's own database front connects to it.
  src/test/online-rig-options.test.mjs holds a path as deep as the train's under the limit.
- The HOLD named `train-v0.1.94-ad1a3ab8`, which was empty, and a local.log that the scratch cleanup had already
  removed. `writeHold` (src/scripts/release-train-proof.mjs) now writes hold.txt into the folder the HOLD names: the
  reason and the last 200 lines of each log it names, before the scratch goes. test/release-train.test.ts makes the
  clone step fail and reads the reason back, and checks that the train calls it before the HOLD receipt.
- The rig runs from the cut, so v0.1.94 is re-cut from a green main that has this fix; the HOLD file works from the
  next train, which loads release-train.ts from the canonical checkout.
