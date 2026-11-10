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

## Build label

`shortBuild` kept any sha of 7 or more characters whole. A hex id is now
cut to 7. The pill and the box both say "v0.1.5 · a8144a5": the engine
version comes from package.json through `__ENGINE_RELEASE__`
(vite.config.ts). On a phone the pill drops " · reload" (it never fitted;
it was ellipsised) and ends before the 36 px logo does. The box lists the
version's CHANGELOG.md section. The daily whatsNew.json and its unwired
24-hour freshness script are gone.

## Hero

The portrait hero was a 1:1 box with `flex: 0 1 auto`, the only row that
could shrink. Check connection (3a19ab3, the Connection doctor, 11-09) added
an 82 px row under SETTINGS on online builds such as play.wildshard.io, and
the open box could push the cards off the bottom edge. On a 402 × 654 Safari
page the hero was 131 px (20%). It now takes all the free room
(`flex: 1 1 0`). On a short screen the gaps and the cards shrink first
(`cqh` against .ws-main as a size container). The open changelog drops over
the hero and doesn't push the layout. Hero: 207 px (32%) at 402 × 654,
386 px (44%) at 402 × 874.

test/title-layout.test.ts builds the real menu, box and pill with the app's
CSS and fonts. It checks the hero share, the label and that nothing
overlaps, in Chromium and WebKit. It runs by name, and CI's e2e job runs it
in Chromium.
