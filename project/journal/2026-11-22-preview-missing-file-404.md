# The preview server 404s a missing file a fetch asks for

> Written by: Claude (mini-qafix), 2026-11-22. Meta QA-FEEDBACK-2026-11-22 row 10.

Sky Reach never reached control on a local phone-tier build: "Scene material overlay requires a mapped library model".
The phone page asks for the cook's `.t512-*.glb` stand-ins, which a local install does not have. The preview server's SPA
fallback answered them with index.html and a 200, so three's loader never saw the 404 that retires a stand-in
(WILDSHARD-GAME-89). Every painted model in the `heroes` library failed and the first `look` row over one threw.
Production's asset host 404s a missing file; the preview server now does the same, with no-store. Desktop tier was
unaffected (it names no t512 files).
