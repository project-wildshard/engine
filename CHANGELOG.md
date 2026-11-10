# Engine changelog

Every engine version, patch releases included, has a section here before it is tagged (Jake, 2026-11-10): one to
five bullets in plain language, written for players and Jake, never commit subjects. The title screen's WHAT'S NEW
box shows the section for `package.json`'s version, beside the build's short commit.

To release: add the next version's section at the top, commit and push it, then run `release.sh vX.Y.Z --prepare`
and `--finish` as before. `scripts/changelog.mjs` checks the format; the pre-push hook and CI refuse a push whose
`package.json` version has no valid section, and a `vX.Y.Z` tag whose commit has none.

## v0.1.5 (2026-11-10)

- Phones and slow graphics chips start worlds more smoothly: the first frames are drawn in small steps, not one long freeze
- The sky and the first frame's graphics are prepared ahead, so you get control of your character sooner
- The loading card's download bar and counters stay accurate to the end
- Copy diagnostics now includes every loading counter
- Hover boost keeps going for as long as you hold it

## v0.1.4 (2026-11-09)

- The loading card shows an honest estimate of the time left
- Voice chat in online worlds, with a mic button in the chat row
- Check connection walks every link to the online world and tells you what to fix
- Settings has a Build row, and one tap on reload loads the new version with instant feedback
- Cmd+W during play asks before leaving, and key hints use your own platform's key names

## v0.1.3 (2026-11-09)

- The first online foundations: the world server, rooms, reconnecting links and saved player profiles
- Holding a direction in an online world moves you smoothly in step with the server
- Creatures and bosses prepare their graphics before you take control, so arriving hitches less
- Leaving the title or a world no longer stalls when the browser's storage is full
- The credits name the Hunyuan 3D model provider

## v0.1.2 (2026-11-08)

- The loading bar moves by how long each step really takes, in three phases, with Copy diagnostics
- Infinite Wildshard shows the area you are resuming while it loads
- Your player identity carries over the progress reset
- The death screen shows before the world closes, and guardians fight as they did before the move

## v0.1.1 (2026-11-07)

- A fresh progress start for every save (epoch one)
- Infinite Wildshard is marked Experimental on the main menu
- Rewards, and Pine Hollow's economy and journal, carry across browsers and players again
- Taming and calling your mount work again

## v0.1.0 (2026-11-07)

- The engine's first release as its own package, split out of the single-player game
