# CI21 port: the telemetry lift tests go to api-server

Jake's J232 (2026-11-10): every lift-pending test moves to the repo that owns
its subject and is rewritten there to prove the same intent; retiring is the
rare exception. The per-file map is project-wildshard-meta
`docs/plans/test-coverage/CI21-PORT-MAP.json`. This is the first batch.

Singleplayer's `api/` never came to engine; api-server owns the cleaner, the
digest and the deployed function. So `telemetry-record` and
`telemetry-cold-start` now live there (api-server 2a0b82d, 2f1c298: record,
build-vercel and telemetry-payloads tests) and leave engine.

`preview-telemetry` splits. The production clean, its refusals and format's
crossroads experiment went with the cleaner. Engine keeps what its own
preview server does: the raw bytes and payload recorded exactly (the preview
stopped cleaning, so the record is the payload), records never served, bad
JSON 400, over 1 MiB 413, wrong method 405, an unwritable target 500 and
Origin-invariant static CORS. The last two cases are unchanged.

All three leave `test/lift-pending.json`; `engine-lift-disposition.json` keeps
their source blobs and original case names. J206 Codex review: one MUST
(check format's experiment independently), fixed in api-server 2f1c298.
