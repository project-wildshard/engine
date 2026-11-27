# Tile budgets count cooked images (SF20)

Once the SDK kept a build's images as images (SF18), 15 of the 18 open plots refused their tile-bake ratchet with no new
content: the census charged a PNG at its file size and at its decoded RGBA, while the page reads the KTX2 the cook makes
of it. Re-recording the baselines would have hidden real growth later (J439 as amended by J444), so the measure moved
instead. A tile is now charged as the cook leaves it: resident as `parseKtx2` charges the cooked file, download as the
cooked file's real size. No formula stands in for Zstandard (it folded the plots' UASTC levels by 11 to 57%), so the
census asks the cook's own encoder, in a child process because the census is synchronous JS and the encoder is
asynchronous TypeScript; the cook's cache by input hash makes a rebuild cheap. All 18 plots pass their baselines unchanged.
