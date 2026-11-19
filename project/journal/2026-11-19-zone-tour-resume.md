# J451. Resume a held zone-entry tour

The release runner can continue an exact staging build from a held phone
WebKit report. It verifies the saved directed pairs against the live route,
walks the shortest already-qualified path from Driftwood to the held pair,
and retains the 82-crossing requirement. A missed pair gets one retry after
a fresh guest boot. The result keeps the first miss and its last grid state.

## v0.1.52 resume at crossing 33

From the engine checkout with the updated tooling:

```sh
bash scripts/browser-lane.sh --max 120 node scripts/zone-gate-proof.mjs \
  --base=https://staging.wildshard.io --out=tmp/codex-ms/j451-v052-resume33 \
  --engine=webkit --target=far-reach --deploy --walk-all \
  --expected-build=cf47558efae969356af515e8148a1f91d445c78b \
  --resume=tmp/codex-ms/j451-v052-rerun/zone-entry.json --from=33
```

The release owner can also repeat the usual staging `go-live` command
with its exact release root and existing local QA and observer evidence.
Use `--zone-entry-resume=tmp/codex-ms/j451-v052-rerun/zone-entry.json`
and `--qa-out=tmp/codex-ms/staging52-resume33`. That run writes the
staging verdict that production reads.
