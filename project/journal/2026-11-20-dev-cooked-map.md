# Cooked maps on the author page

> State: 2026-11-20. Mirror Salt MSZ41b.
> Written by: Codex

The author server can stamp the slug whose local cook maps it serves.
When the devserver grid sees that stamp, it uses the same full and cell
PNG paths as the published cook. The normal author-map precedence
remains in the map reader, so an author can inspect their own map.

The existing client map selector still uses placed upload URLs on
staging and production. The local stamp is read on devserver builds.
