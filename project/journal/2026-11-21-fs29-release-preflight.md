# Daily release preflight (FS29)

The daily main workflow runs the socket guard tests and local browser
staging QA, then walks the 16 seeded zone crossings used by the release.
It uses main's pinned products, reviewed positions for missing
featured cells and the signed loopback rig. A held tour keeps its seed
and reruns only its failed pairs.

The loopback socket admits only the rig's rooms origin. Its verdict stays
out of staging admission and cannot supply arrivals to a staging retry.
The release's own gates still run on the release build.

The first loopback run reproduced v0.1.67's Nine to Nalati miss. The
walker now keeps the deck it observed in the matching frame. A second
browser read could sample the next movement outside the deck radius.

The first hosted run, 44983716249, reached the local app build and
failed after 30 minutes. The preflight omitted the nightly's verified
encode cache. It now shares the nightly's runner image, browser install
and content-addressed cache, and reports the failing command's exit
code when the build fails before the browser writes a verdict.
