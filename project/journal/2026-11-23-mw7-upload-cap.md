# MW7: the cook reads the upload cap from format

> Written by: Claude (lane mini-mw7)

`cookJob.ts` held its own `MAX_SHARDFILE_BYTES = 450_000_000`, and the hosted cook-cache proof a second copy. BUG-3 was
the day the cook and the API disagreed (300 MB against 450). shard-format 0.73.0 exports the cap from `./uploadCaps`;
`cookJob.ts`, `cookWorker.ts`, `uploadTransport.ts`, `cook-worker.mjs` and the proof import it there (engine bans
re-exports, so `cookJob.ts` no longer exports it), and `test/upload-cap.test.ts` fails if a literal copy comes back.
The pin moves 0.71.0 to 0.73.0; 0.72.0's changes typecheck clean here. api-server reads the same export (c6b6973).
