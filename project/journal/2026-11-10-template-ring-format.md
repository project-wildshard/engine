# Ring 1 reads Template 2 from the format dependency

Ring 1 installs the frozen `@wildshard/format` Template 2 product through
the normal product validator. Its catalogue and retention set use the
admitted product's own hash and revision. The default full pin install
still follows the deployment catalogue.

In a disposable pin cache holding only the two other Ring 1 tarballs,
five slices and pinned saves, macOS `sandbox-exec` denied networking.
The old command refused because its Template 2 tarball was missing.
The changed command admitted all three products and five slices in
1.3 seconds. `pins.ts status` named the installed format dependency
and its exact index hash.

T2E-1 remains open until the real Template 2 smoke passes with external
networking denied. This install proof did not exercise that smoke.
