# Engine package on npm next

The v0.1.37 and v0.1.38 staging trains left npm at v0.1.36.
Shard authors need a published engine to prove against the declared
kit. The coordinator approved npm v0.1.39 once staging is qualified.

The existing trusted publisher can take an exact qualified staging
build from main. It requires branch CI, the browser and SM5 proof, the
signed staging release, and the served page. That path publishes with
the next dist-tag. A version already published on next needs an
authorized latest dist-tag promotion when production ships. The
version-tag job flags that step if it is still pending.
