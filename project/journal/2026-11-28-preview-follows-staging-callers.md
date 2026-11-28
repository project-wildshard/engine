# 2026-11-28: engine's callers stop treating preview as movable

- Meta QA 11-26 row 10, the sweep after row 9 (api-server 300f304): preview follows staging. No one moves the preview
  pointer or format; the API answers such a move with 409 naming staging.
- `admin.mjs format preview <X>` was still offered in the usage text and sent the PUT, which the API now refuses. It refuses
  at once with "preview follows staging: move staging", and the usage names staging and production only.
- `format-floor-pointers.mjs` listed preview's pointers beside staging's. Preview's pointers are staging's, so a low staging
  pointer was listed twice and its fix looked like two flips. It lists production and staging only.
- Left as they are: `admin.mjs`'s `shardfile.new` notify (`stage: 'preview'`, a shardfile's stage, not a channel pointer) and
  `channelHeads`' read of the catalogue's legacy `preview` head (it reads, it moves nothing).
- Guard: test/admin-cli.test.mjs (a preview move refuses before any request) and test/format-floor-pointers.test.ts
  (no preview channel, no preview pointer listed). sharddev's revival line is the same row, in sharddev.
