# Settings: one Settings everywhere, Reload now stays in the shard, Feedback in System

Meta SETTINGS-REDESIGN SR11, SR12 and SR13, which also close what SR3 and
SR4 left open. Jake, 2026-11-10: "stick within one style", and J245 picked
layout A for the in-game Settings.

**SR11.** The title's Settings (`BootSettings.ts`) was its own column:
renderer picks, an Apply & reload footer, and the 2026-09-23 rule that the
main menu's settings could differ from the pause menu's. Now it builds the
same tabs through `buildMenuSettings` with `title: true`. The in-game-only
rows stay out: Review, the game's shard save cards (a level adds them) and
the weapon rows (gated off, nothing is held on the title). Its Graphics tab
gets the phone controls from `graphicsSettingsControls()`, handed in as the
menu's own list rather than registered: the registry belongs to a level,
and a level's disposer would remove a shared id the title had registered.
The Apply & reload footer is gone; each tab's own Reload now does it, as in
game.

**SR12.** Graphics ▸ Reload now dropped the player on the title for two
reasons: `reloadWithPicks` stripped every title-skipping param, and it
called `markReload` with the default `reload` reason, which `bootRoute`
reads as an explicit RELOAD and sends to the title (and which discards a
grid recovery record). In a world it now sets `?at=` (the level's authored
frame) and `?glreload`, as GPU recovery does, and marks the new `settings`
reason: no title rule, and the grid's capture writes a planned reload, so a
grid page resumes from its record. An online build also hands its own tab
the tap that seated it (QA row 16), since a level there enters only from
a tap. With no pose (the title) it stays an explicit reload to the title.

**SR13.** The FEEDBACK tab sat as a second tab bar over the five tabs
whenever the review inbox was unlocked. It has no tab now. System ▸
Review gets a Feedback row whose Write button opens the composer's panel;
a back bar returns to System, which the tabs still have selected.

Proof: `test/settings-tabs-browser.proof.mjs` unlocks review against a
stubbed inbox, checks there's no outer tab bar, opens and leaves the
composer, then walks the title's five tabs (phone and desktop). The two
`reloadWithPicks` cases in `test/leave-saved-paths.test.ts` check the URL
with and without a pose.

Found on the way: a registered Graphics control (graphicsBlock.ts's
Quality) saved its reload pick without repainting the tab's Reload now
row, so the row stayed hidden until the menu reopened. Taps stop
propagation, so the tabs now repaint those rows from a capture listener.

One Codex review (J206, read-only): three MUSTs, all folded in before
the land. The default `reload` reason sent the page to the title; an
online build had no tap to enter with; the title's Saves and System rows
belonged to whatever level was up. A grid page (no `?chunk=`) now
reloads on its bare address and resumes from its record.

Real path: a built Driftwood, headless Chromium at 402 × 874: Settings ▸
Graphics ▸ Quality to Phone, Reload now. The page went to
`?chunk=driftwood-isle&at=0,2.01,-194,1.2,0&glreload=1`, came back in
Driftwood under Settings, ran the phone tier, and showed nothing pending.
