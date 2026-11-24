# Staging pins carry the release hash

Meta MACBOOK-WAITS MW1 (TEST-COVERAGE row 23): api-server AP-26 went live (c6b6973), so the staging catalogue GET names its
release in `x-wildshard-release-hash`. `pins.ts refresh --channel staging` records it as `releaseHash` (no more `null`), and
`pins-staging.ts verify` refuses when live staging has moved past the committed snapshot; a staging-pinned nightly runs it.
