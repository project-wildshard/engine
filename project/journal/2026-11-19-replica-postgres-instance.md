# Keep the scratch cluster's systemd path valid

The signed v0.1.48 replica refused to boot during E7.4b.c. Debian's
`postgresql@.service` asserts the config path using the unescaped
instance. The dashed name expands to `16/wildshard/replica`, while
the config lives under one cluster directory.

Use `wildshard_replica` so startup and restart name the real directory.
Cleanup also drops an older scratch name if one exists. The test
reproduces the box's path assertion before exercising the fix.
