# Carried files and the staging worker update

The v0.1.39 SM5 K1 run and its one repeat both ended on Chromium's old
v0.1.36 page. The saved v0.1.38 run did the same. A browser trace saw
the candidate register and activate at 57 seconds. A later navigation
loaded it.

Staging bakes the worker again after the retention step has copied
earlier deployment graphs. That second bake walked the merged folder,
so the new worker tried to install 420 files (51 MB) present solely
for older builds. The current worker's own file list has 164 entries.

Use the same carried-path calculation as the page budget report.
Shared paths that belong to the current graph still precache. The
deployment still serves the older paths. The regression test failed
first on both an older build folder and an older shared code path.

The filter uses the deploy manifest's code pattern. A legacy graph can
list art and fonts missing from the current graph's code-only inventory.
The test also covers retaining a current font in that case.
