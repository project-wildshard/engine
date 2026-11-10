# The title names the engine version, and every version has a changelog

Jake, 12:05 Cancún, from his iPhone on play.wildshard.io: "Can we show the
short commit, not this long ass thing?" The build pill and the WHAT'S NEW
box both printed the world build's id, which is the full 40-character
engine commit; the pill ran over the logo's D and the box's own title was
squeezed to nothing. "Let's change the release flow for the patch version
of the engine to make a changelog mandatory." A minute later: "The hero is
so fucking tiny on the main menu."

## Changelog

CHANGELOG.md at the root, one section per version, 1 to 5 bullets written
for players and Jake. scripts/changelog.mjs parses and checks it and picks
the section for package.json's version, which the box lists when opened.
The pre-push hook refuses a main whose version has no valid section and a
vX.Y.Z tag whose commit has none. CI's changes job checks GITHUB_SHA too. The
next version's section may land above the current one, so the order is:
write the section, push, then release.sh --prepare and --finish as before.
release.sh is untouched. v0.1.0 to v0.1.5 are backfilled from git history.
