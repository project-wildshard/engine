# Publish the build road to the cooked store

PV25's versioned rooms already read zone packs from the cooked host.
Their road worker used the build book at the legacy origin. Moving the
zones left staging dependent on the bucket PV15 will retire.

Page release publishes the road strips and a grid-only book at the
cooked origin before the legacy book becomes visible to the signer.
It checks the exact bytes and CORS, and retries reuse existing objects.
The room uses that same build key when its versioned reader is enabled.
The road journal reports which reader loaded the strips.
