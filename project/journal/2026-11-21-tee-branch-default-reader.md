# Tee branches read by their default reader

Hosted Nine Explorer (run 44931587282, after 9b86261597's evidence) stopped at
"Reading build files" with no request pending and exactly one `Read Model data`
wait open for 60 s; every other read finished within 0.4 s. With no service
worker controller, `readAsset` clones each response to publish it, so the read
continues on one tee branch through a BYOB scratch reader. That is the same
Chromium shape as 9048c5356a's prefetched Blob: every byte delivered, the final
BYOB read never settles.

`readByDefault(response)` marks the branch after `clone()` in `readAsset` and the
spawn store's copy; scratchReader then uses the default reader. The tee already
copies every chunk for the other branch, so the pool saved nothing there.
