# QA 49: tabbed Settings prototypes, behind a Debug row

Jake, 2026-11-10 ~21:45 Cancún: "the pause settings just complete clusterfuck.
There's no graphic settings over there… that button should be settings,
shouldn't be pause… a settings menu with a bunch of tabs at the top… lots of
variants, lots of in-game prototypes". Plan: meta
`docs/plans/SETTINGS-REDESIGN-PLAN.md`. Branch `plan/settings-redesign`,
not landed until Jake picks.

Five layouts (A Bag tabs, B side rail, C thumb tabs, D quick + all, E six
words) in `settingsTabs.ts`. Each one re-parents the rows the shipped
Settings already builds: `menuSettings.ts` and `SavePanel.ts` now tag each
row `data-sv="<key>"`, so every switch keeps its listeners, and `dispose()`
puts every row back. The Graphics tab is new: the phone's Low / High
(MG2, live) and the boot-time picks the title holds (quality, render scale,
AA, touch controls), with a Reload button when one is pending.

The brief asked for `?settingsVariant=`, but Jake's own rule is no URL
switches (2026-09-25, `lint/url-params.json`): the pick is a Debug row,
Tools ▸ Settings layout, live and saved per device. Under any layout the
touch HUD's PAUSE becomes a cog and SETTINGS, and the menu title reads
Settings. `settingsCats.sync` stands down while a layout holds the rows.
