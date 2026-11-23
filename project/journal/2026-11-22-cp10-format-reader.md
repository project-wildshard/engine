# Pick up the CP10 format release after the API deploy

The format v0.69.2 corpus and npm publish passed on the second attempt
of run 44964882922. API v0.34.2 was deployed first. Its public health
response names shard-format 0.69.2 and the active format stays 0.1.0.2.

Pin the same reader in engine for CP3. The existing pinned originals
continue to be read as stored. All ten pin checks passed with the new
reader.
