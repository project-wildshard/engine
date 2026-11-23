# CP2b2b: the cook matches the API's migrated copy

> Written by: Claude (opus-compat-w6), 2026-11-23

The catalogue's channel blocks list the API's migrated copies of each original
(raw, format, copy digest, chain id, status). The cook worker now reads them,
takes the ok copy at the engine's format as the head's expected copy, and after
a job refuses to publish when its own chain made a different digest under the
same chain id (FE9a's `provenanceRefusal`). The cook keeps downloading and
migrating the signed original itself, so it never has to trust an unsigned
copy: the API's digest is a cross-check, not an input.
