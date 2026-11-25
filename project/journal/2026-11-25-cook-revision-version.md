# A release bump no longer moves the cook revision

Meta QA 11-24 row 44 (MA14b) asked why v0.1.90's cook carried nothing. SP7's recook rule copies a head's index from
another build when the cook revision is unchanged, so a release that touches no cook code should cook nothing.

v0.1.89 (`47f94df1`) hashes to `338d2aad` here and v0.1.90 (`75fd4b97`) to `b0ef8f85`, and the only closure file that
differs is package.json's `"version"` line. FP47b's engine floor (`engineFloor.ts`, 11-24) reads the version through a
literal `new URL('../../../package.json', import.meta.url)`, which the closure walker follows, so every release since
has recooked every head. On the box the v0.1.90 worker queued 38 heads and carried none, while staging had 18 of its
25 heads and production 25 of its 27 already indexed for v0.1.89. The 0.1.0.6 format move did not cause it: it made
new staging heads, which v0.1.89 had mostly cooked by then.

The cook reads only `version` from package.json, and the version can't change a passing cook: it only refuses a
product whose floor is above it, a release only rises, and `carry` copies passing indexes only. Its dependencies are
already hashed through the lockfile and the format pin, and `exports` only decides which files join the closure. So
package.json adds nothing to the hash (`revisionBytes`): a version bump, QA 11-25 row 41's `engines` pin or a script edit
keeps the revision, while any cook file still moves it. This change itself moves the revision once, so the release that ships it recooks once
more; the release after it carries. Test: `test/cook-revision-version.test.ts`. opus-ma.
