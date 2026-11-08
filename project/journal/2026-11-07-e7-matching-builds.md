# Give coordinated pages and servers one build identity

The CI half uses the full source SHA for its dedicated build. The page
builder previously ignored an explicit WS_BUILD_ID and always minted a
short SHA plus timestamp. The native producer path reproduced that
mismatch. Honor a validated explicit value, preserving the default for
ordinary page builds, so the requested same-commit page/server proof can
also use the same wire build ID. Record the producer contract in the
release documentation. The final integrated artifacts must demonstrate
it; no page deployment or secret change is part of this work.
