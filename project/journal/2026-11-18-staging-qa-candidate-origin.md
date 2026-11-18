# SQ6 candidate origin

A Worker version URL cannot join the staging rooms directly. The room door
and pack CORS use the staging origin. Browser QA now serves the checked
release's page under that origin inside the owned browser processes. It
compares the four page documents with the Worker before opening a browser,
keeps the staging rooms and packs on their usual TLS connections, and checks
the signed serial and public alias again before writing the verdict.

Chromium uses the candidate certificate pin from SQ18 so its saved service
worker can fetch the update. The candidate reads a copy of the previous
saved profiles. Its output leaves the live QA store available for the
post-flip run. Browser journeys run sequentially while the local proxy
keeps serving their requests.
