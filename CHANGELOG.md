# Engine changelog

Every engine version, patch releases included, has a section here before it is tagged (Jake, 2026-11-10): one to
five bullets in plain language, written for players and Jake, never commit subjects. The title screen's WHAT'S NEW
box shows the section for `package.json`'s version, beside the build's short commit.

To release: add the next version's section at the top, commit and push it, then, from the canonical checkout on main,
run `../repo-kit/release.sh vX.Y.Z --prepare` and `--finish` as before (the helper lives in the sibling repo-kit clone).
`scripts/changelog.mjs` checks the format; the pre-push hook and CI refuse a push whose `package.json` version has no
valid section, and a `vX.Y.Z` tag whose commit has none.

## v0.1.18 (2026-11-13)

- Share a shard with a link: play.wildshard.io/slug/driftwood-isle opens that shard and shows its name and picture in chat previews.
- New shards placed on the world grid after a release, like Thin Ice, get their own card in Shard select and you can walk in.
- iPhones use less memory: Driftwood loads compressed textures, and the world file loads with far fewer allocations.
- Walking off a shard's edge no longer stalls while the next shard builds, and Driftwood Isle and Pine Hollow have their sounds back.
- Behind the scenes: we log each player's device to find crashes, and shard authors can prepare a release without the engine source.

## v0.1.17 (2026-11-13)

- Crossing is on: walk off one shard's edge into the next at full speed, with no invisible walls at chunk edges or seams.
- On phones, touch play never locks the pointer, a back swipe keeps you in the game, and the death card has a Respawn now button.
- Quest markers and other pins sit on their targets in every grid cell, and Driftwood's near scenery stays drawn up to its edge.
- The title shows the build and a reload button at once, a stale build makes you update, and a loading shard shows its own card.
- Android phones without half-float textures fall back instead of failing, a lost GPU returns you to the world, and errors reach us.

## v0.1.16 (2026-11-13)

- Pine Hollow's spawn shows its own textured ground, no longer bare tan slopes.
- The world grid has room for 7 by 7 shards (the same 25 for now), and the empty spots between them are flat ground you can walk on.
- The engine's command line tool, which crashed when installed from npm in v0.1.15, now runs.
- Behind the scenes: the server can open a newly placed shard without a restart (off for now).

## v0.1.15 (2026-11-13)

- Music plays piano only now; the music style choice is gone from Settings (this came in v0.1.14, whose notes missed it).
- Shard select opens Sky Reach, Signal Dunes, Nine Dragon and Mossgate to every player; open plots are reached by walking the world.
- Nalati and Sky Reach open on desktop in the world grid again, and Brasscap Mesa opens beside Driftwood without an error.
- Finishing a quest no longer freezes your camera and controls for several seconds.
- You can swim back up out of the Mossgate pond, and the Developer tab has an Unstuck button.

## v0.1.14 (2026-11-12)

- Online, other players look like players: their body, held item, moves, attacks, health bars, Name and a dot on your minimap.
- The loading bar's percentage follows the real work, a reload takes you back to the main menu, and a slow link no longer stalls START.
- Shard select puts you in that shard's spot in the world grid, now with the templates in the middle; Infinite Wildshard is Developer only.
- On phones, chat docks above the keyboard, and a missing game file is never cached, so it loads once it is there.
- Heavy attacks land as heavy, and more of the game's rules run on the online server, like status effects, feats and quest secrets.

## v0.1.13 (2026-11-12)

- The Template has its new Mossgate look, and Pine Hollow is on its second version.
- Falling through the ground catches you and puts you back on solid footing.
- Other players move more smoothly online, and walking Signal Dunes' slopes no longer snaps you back.
- The rope bridge holds when you cross it online.
- Nine Dragon and Nalati load all their files again, and the HUD's ready card sits in the middle of the screen.

## v0.1.12 (2026-11-12)

- The game's pages now load from Cloudflare.
- Pine Hollow opens on desktop again when one of its characters' models is missing.
- Swords and other held weapons swing with each strike.
- Quitting an online game takes your character out of the world at once, even on a shaky connection.
- Single player saves your progress as you play, so a reload picks up where you were.

## v0.1.11 (2026-11-11)

- Picking the Template card on Shard select takes you to the Template's spot in the shared world again.
- Signal Dunes and Sky Reach no longer stop at the "home" loading step when you pick them from Shard select.
- The game's pages now load from Cloudflare.
- Boss health bars show the same shield for you and everyone else in the room.

## v0.1.10 (2026-11-11)

- Game files now come straight from Cloudflare's CDN.
- You can hear the first player in a room again; they no longer show as too far away.
- A player who takes over a room's first spot shows their own Name, not the last player's.
- Picking a shard online opens the shared world grid again, so the Template's spot is reachable.

## v0.1.9 (2026-11-11)

- The game connects to its new server address, rooms.wildshard.io, on the ordinary web port, so more networks let you in.
- Voice fades with distance, a ring shows who is talking, and Settings has a Voice panel with hold to talk.
- Everyone gets a unique Name, and global chat reaches every player in the world.
- Picking a shard on the title takes you into the shared world at that shard, and the Template's spot in the world opens again.
- Nalati's herds no longer stall the shard, and a stuck start now reports why.

## v0.1.8 (2026-11-11)

- Settings has tabs like the Bag, with graphics controls for pixel density, shadows, glow, sun rays and anti-aliasing.
- Graphics has Low, High and Custom presets. Low runs at 60 fps when Low Power Mode is off.
- On desktop, chat and the mic sit bottom left. Pressing B to talk now says what it did, and single player stays quiet.
- Loading after an update is faster, since most world files no longer download again. Nalati saves load nearly twice as fast.
- All 28 shards are prepared and pinned, and the server only trusts its own proxy for each player's address.

## v0.1.7 (2026-11-10)

- Tapping through the title quickly on iPhone no longer reports a loading error.
- Double-tap HOVER to boost. The chat corner takes up less space until you open it.
- Home-screen icons make it easier to tell the live game, staging and preview apart.

## v0.1.6 (2026-11-10)

- Phones get Low and High graphics. Low Power Mode switches to Low on its own, and the first time you play you can try both in Driftwood.
- The loading screen has Settings and Exit to title, so you can back out of the wrong shard.
- You now arrive where you left off, without a jump after loading, and you no longer appear in the world before you press Play.
- The title shows a short version with its changes.
- Clearer screens when the connection drops or the server restarts.

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
