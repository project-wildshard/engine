# Keep released save downloads immutable

Ring 1 could not fetch the already-published Nalati fixture: GitHub's bare
browser download URL returned HTTP 504, while its explicit `?download=1`
route returned the existing 9,565,519-byte asset. Its SHA-256 remains
aa96f2980ef0cc80db1b0cfbf02235649546a5b486f5f71c1f34c9008573edbe.
No fixture, baseline or release asset changes.

Save installation now tries that explicit route without a cached response,
then the canonical URL on transport failure. Each request has a bounded
90-second network deadline. Corrupt bytes still fail immediately, before
cache publication. A real cold-cache Nalati installation succeeded.

Four actual TCP-server/CLI checks cover success, gateway fallback, corrupt
content and a missing asset; all pass in 0.69 seconds. Typecheck and lint
pass. These checks add no hook commands.
