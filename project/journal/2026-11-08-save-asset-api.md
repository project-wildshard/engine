# Read the existing save upload through its asset API

The explicit browser-download repair passed a real cold local install but
exact hosted CI 42469066711 still failed Nalati save installation. Repeating
the network probe locally now reproduces HTTP 504 on both `?download=1`
and a fresh-query browser URL (11.25/11.23 seconds). This remains open on
the published 8fb2aef; its full normal local gate was green in 716.8 seconds.

The public release already holds asset 723089032, uploaded, 9,565,519 bytes,
with digest aa96f2980ef0cc80db1b0cfbf02235649546a5b486f5f71c1f34c9008573edbe.
Its public asset API with Accept: application/octet-stream returned HTTP
200 and those exact bytes/hash in 636 ms. This is GitHub's documented
[binary download endpoint](https://docs.github.com/en/rest/releases/assets#get-a-release-asset).

Record that existing immutable asset ID as fixture provenance and prefer
its binary API. Keep both browser routes for transport fallback; any corrupt
body still refuses immediately. The save blob, hash, size, original release,
gameplay checkpoint and epoch are unchanged. No asset upload or replacement.

Seven actual TCP-server/CLI cases pass in 1.13 seconds, including the binary
Accept header, API fallback and corrupt API refusal. A second real cold CLI
installation fetched all 9,565,519 bytes through the API. Types and lint pass.
This additive commit still needs the full normal pre-push and fresh hosted
CI/Ring 1 before release preparation; no v0.1.2 tag is created.
