# FS27a: pin-push Ring 1 slices

The v0.1.61 release dry-run had every full pin but none of Ring 1's five
server slices. The push digest task now installs the verified slices
before running its selected slugs. The same installer serves standard
Ring 1 and leaves full products and their catalogue available to Vitest.
