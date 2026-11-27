# Select the signed versioned cook

PV25 could stage the new bucket credentials but had no command to
select them. The VPS helper now accepts the exact signed staging tag
that carries a complete cook address. It moves the tag and store in
one settings write and restores both if the cook fails its health
check. The legacy recovery command requires a signed production tag.

The tests run the real signature check and cover missing credentials,
old releases, explicit settings precedence and rollback. The scoped
credentials stay in the root-only environment throughout.
