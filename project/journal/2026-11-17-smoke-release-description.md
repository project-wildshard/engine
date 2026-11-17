# Smoke accepts a release repair's exact identity

The full v34 smoke ran its gameplay scenarios, then held on SB7 because
version.json described the repaired release as v0.1.34-2-g4e297a197.
That is the intended engineRelease label: existing SB7 tests explicitly
keep a count for commits after the release cut. The build and client
version were correct; strict describe equality was the false positive.

Accept that counted label only when its release matches, its abbreviated
SHA matches the full candidate build, and clientVersion matches too.
Exact release labels remain valid. Wrong builds, client versions, release
prefixes, short hashes and malformed suffixes still hold production.
No gameplay, error, vision or smoke hold checks are disabled.

Red first: a real temporary Git release followed by a repair reproduces
the false hold; a wrong clientVersion exposes the old missing check.
The repaired smoke must run fully again; the original held verdict stays.

Validation: the two new failures are red on the original check; all83
smoke, release-description, changelog and production-gate cases pass
afterward. Source game build4e and every gameplay hold remain unchanged.
