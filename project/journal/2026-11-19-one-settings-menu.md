# 2026-11-19: one Settings menu, player-first (J458)

Lane: opus-hud-layout (meta QA-FEEDBACK-2026-11-19 row 16; board "One Settings Menu", option A).

Jake picked A with one change: "we must keep the dev menu. The dev menu is behind the dev toggle ... I need the dev
menu. I need the dev toggle." So the Developer mode switch stays a visible switch in System, and DEV still shows only
while it is on. The rest of A: Saves folds into System under "Progress file" (the `saves.game` / `saves.file` group ids
stay, so a game's `addSettingsSection('saves.game')` lands there unchanged); a phone's developer Graphics rows (the
pixel count, the frame readout, Quality, Running now, Reload now, the In-world toggle and Replay first-time setup) move
to DEV ▸ Graphics through a new Graphics control section `dev`; the preset cards drop their explainer note and keep
the effect toggles listed below, with Custom lighting up by itself. A desktop's Graphics is unchanged. The title and the
pause menu still build the same tabs (SR11), so both changed together; the settings browser proof walks both.
