# Make cached imports follow the actual local alias

J196 deliberately changes node_modules aliases without touching locks or
root manifests. The real cached import proof reproduces stale value1after
its declared dependency link switches to value2. Root/package retag keys
alone cannot identify the resolved addresses retained in a cached caller.

Include each declared dependency's real directory and package manifest in
the key. This covers alias mode and an export-map change inside that same
local package, while missing dependencies get a distinct marker. No source
is shared across isolates, no gate is omitted, and no worker or clock is
changed. The actual unchanged-caller proof is green after the alias swap;
cold/warm/root-retag cases also pass (259/154/203ms). Explicit string/number
tuples keep its JS proof fully typechecked. Focused lint and the complete
ordinary layered compiler pass in a frozen clone.

The final stamp is derived from a clean clone of328cabf plus these exact
owned changes, including Pine's committed channel implementation. Neither
J196's managed live links nor any foreign source file is changed. Publish
with the ordinary full hook and wait for exact hosted proof; the three
minute full target is still open.
