# Keep the cook inside its publication paths

The first scope fix missed the root names under assets/spawn, including
client manifests. Treat that entire pack namespace as cook-owned so
the existing hard budget test and the published manifests still count.

The audit also found that loose source mounts could reach the store
writer. Validate every output path before publishing any object. Keep
release files and the signed item catalogue outside the cook's paths.
