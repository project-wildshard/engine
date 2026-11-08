# Give the existing reward cases their environment

The server reward file mixed three DOM-free controller cases with one
actual caption/objective/weapon lifecycle case. The four original cases
pass in happy-dom, 448 ms total runner time. Move only the existing page
case unchanged into the client reward test file; the server file now owns
its three existing cases explicitly in Node. No production page, pose,
layout or renderer code changes, and no assertion/case is added or removed.

This closes the previously deferred CI12 test-ownership seam without
requiring page implementation work. Node/DOM discovery grows by one file
while preserving the exact same four case names and all effect ordering,
restoration, refusal and disposal assertions. The new file is relocation
of an existing hook case, not an added slow proof or permanent exclusion.

Both owners retain four cases and pass in 675 ms total runner time. The
required renderer revision is regenerated because its client source
inventory now contains the relocated test file; no page body is edited.
