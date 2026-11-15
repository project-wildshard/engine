# CI21-H2 frozen fixture boundary

CI21-H2 begins with immutable Nalati source fixture bytes emitted by the
shard's one-shot exporter. The engine reader validates every selected file
against the exporter manifest before consumers decode it, so test ports can
replace shard imports without accepting unchecked copies. The manifest binds
the fixture bank to shard-nalati `b40cd2a`.

The export keeps the paint fixture's generated JSON declaration beside it,
which preserves the engine-wide declaration contract for copied JSON.
