# The page Workers send the headers Vercel sent

Meta OFF-VERCEL-PLAN row OV2 (J272). `public/_headers` carries one rule
for each `vercel.json` header rule, and the build copies it into `dist`.
Cloudflare joins a header that two rules set, where Vercel let the later
rule win, so every overriding rule first detaches (`! Cache-Control`).
Version URLs (`https://:version.:subdomain.workers.dev/*`) say
`X-Robots-Tag: noindex`.

Three things only showed up by measuring:

- **`Content-Encoding: br` from `_headers` double-encodes.** A 13-byte
  stored part went out as 17 bytes: the runtime brotlis it again. So
  `/assets/spawn/{parts,server}/*` run the Worker, which adds the header
  and answers with `encodeBody: "manual"`. The raw bytes now equal the
  file for any `Accept-Encoding`.
- **`pages/worker.ts` could not start.** It exported the string
  `DOCTOR`, and workerd treats every named value export as an entrypoint.
  OV1's dry-run test never ran the Worker; `wrangler dev` does now.
- **Play answers `?doctor` with 307, not 302** (Vercel's
  `permanent: false`), keeps the query as written
  (`/?x=1&doctor` → `/doctor/?x=1&doctor&sw=0`), and adds `; charset=utf-8` to JSON and the web
  manifest and calls JavaScript `application/javascript`. The Worker and
  `_headers` now say the same, so parity finds no difference.

`scripts/page-parity.mjs <old> <new>` compares status, cache-control,
content-type, content-encoding, clear-site-data, location and a digest
of each 200's decoded body on 30 URLs, hashed names found on the old
host. Codex's review added the last two: without them a part encoded
twice, or a redirect elsewhere, passed. Against play and a local `wrangler dev`
holding play's own files for those URLs: no difference.

Not here: COOP and COEP. PAGE-SIZE PZ12 and OV6 add them on preview
first, after the cross-origin audit (J274). Workers answer a `Range`
request with the whole file; the trailers move to the packs CDN (J272
answer 6), and a test pins the 200.
