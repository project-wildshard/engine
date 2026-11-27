# Refresh cook provenance on an upload notice

The VPS cook had refused Nalati and Nine against old API records.
Correcting the catalogue and notifying the worker left those refusals
cached. A worker restart happened to pick up the corrected records.

The worker now reads the notified channel before judging the exact
slug and hash. A changed migration record reopens that hash's refusal.
A slow catalogue poll cannot replace a record read after the notice,
and a refusal produced against a stale record stays out of the cache.

The regression seeds a stale refusal, sends a notice after the API
correction and checks the published index while an older poll is still
pending. The polling tests also retain priority for newly advertised
uploads. The golden cook output still matches 1.17.0.
