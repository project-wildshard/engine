# Cooked shard version

The cook binds the authored shard version into the cooked `cook.json`, and
its output header names the new metadata digest and byte count. For an older
stored upload the authenticated catalogue version supplies the same field.
The engine pins format 0.81.0 to read both envelopes. The cook recipe bumps
its version because the emitted metadata can change.

A real migrated fixture shows the author's version, including its prerelease,
and checks the published header's binding. The rename-chain proof checks
that legacy metadata stays identical across the two equivalent cook paths.
