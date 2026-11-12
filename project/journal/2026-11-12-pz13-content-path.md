# PAGE-SIZE PZ13: a content base with a path

- Red first: `content-base.test.ts` asks for PZ2's `https://packs.wildshard.io/content/<set>/` base (accepted, path kept on
  every read: spawn download, server worker, boot tables, title art) and still refuses a query, a relative base and
  another scheme. Before this row the client refused any path but `/`.
- Green: `readContentBase`/`stampContentBase` take any http(s) base whose path ends in `/`; `contentURL` resolves under the
  base's folder and `pageURL` strips it. Root-absolute book paths resolve under the folder too (`onPacks` in the spawn
  download, `besideShard` in the solo server worker), and the fetch layer and texture packs look members up by page path.
  The boot tables and `titleAssetURL` read through `contentURL`; the stamp moves the document's own title art (startup
  image, launch hero CSS, the title URL table's values) to the base.
- Proof: `content-base-proof.mjs --set=<16 hex>` serves `dist-content/` under `/content/<set>/` (404 outside it) and fails
  on any page-origin 404. On the split build, Driftwood and Pine boot solo, zero 404s on either origin, no preflight;
  the origin-only run still passes.
- Review (one `codex exec`): three MUST. A bare `?` or `#` passed both validators (empty search/hash), now refused; a base on
  the page's own origin under a content path was moved twice, now a URL already in its folder stays; the third was a stale
  tree (fixed by rebasing on main). The SHOULD on `entryTransport.ts` (its bootstrap dropped the folder) is fixed too; the
  test-order note stays a comment.
