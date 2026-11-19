# Stamp author-client archives with the release SHA

The v0.1.46 publisher built author clients without passing a build ID.
That made `build-app.mjs` generate a short local build stamp. Both
archives now use the source SHA selected by the release workflow. The
upload checks the build, version and preparation flag in the archive
before it can become immutable on the release tag.

A failed preparation build is visible in the author-client job. Its
upload step can still publish the devserver archive when that build
succeeds. For v0.1.46 the release lane built and verified both archives
from the exact tagged checkout.
