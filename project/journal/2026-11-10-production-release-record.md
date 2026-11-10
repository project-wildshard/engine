# Create production release records from their tags

v0.1.6 producer `42918719787` built the exact `ad7b145` archive. Its
asset step returned 403 before any release record existed. The publish
job showed Contents write, and a maintainer-created record for the
already-pushed tag let attempt 2 upload and sign the exact archive.

GitHub documents a workflow-write check when an explicitly supplied
release target differs from the default branch under `.github/workflows/`.
For production the tag already identifies the target. Verify its remote
peeled SHA before creating metadata without an explicit target, then
verify it again before using the archive. Staging tag creation still
supplies its exact target. GitHub errors name the failed operation.

The CLI regression exercises production and staging creation against
the documented permission rule, with missing and foreign tag controls.
The next version tag is the first hosted creation proof for this change.
