# Engine changelog

Every engine version, patch releases included, has a section here before it is tagged (Jake, 2026-11-10): one to
five bullets in plain language, written for players and Jake, never commit subjects. The title screen's WHAT'S NEW
box shows the section for `package.json`'s version, beside the build's short commit.

To release: pass one to five player-facing bullets in a notes file to
`../repo-kit/release.sh vX.Y.Z --prepare --notes <file>` from main.
The helper writes this section, version and stamps on `release/vX.Y.Z`
(J360/J362; meta RELEASE-BRANCHES). After staging proofs, `--finish`
tags that exact green head; after publication, `--merge-back` brings
it into main while other lanes continue landing.
`src/scripts/changelog.mjs` checks the format; the pre-push hook and CI refuse a push whose `package.json` version has no
valid section, and a `vX.Y.Z` tag whose commit has none.

## v0.1.97 (2026-11-26)

- Nine Dragon no longer shows a false "World not drawn" reload card after it loads.
- Nine Dragon's look and distant views load on the shared world grid.
- The game page carries one copy of its 3D library, so it loads lighter.
- If a zone fails to load, the error now says how far it got, so it gets fixed faster.

## v0.1.96 (2026-11-26)

- The game reads the newest shard format, so zones published with the latest SDK open as built.
- Travelling between zones keeps the address bare, and the menu's back button returns to the main menu after a trip.
- Fights in grid zones and the practice room work again, and Sky Reach's distant views load.
- An upgraded weapon keeps its slot, and ammo finds the weapon it belongs to.
- A slow early server no longer holds up the first picture on lower-power devices.

## v0.1.92 (2026-11-25)

- Pine Hollow, Driftwood Isle, Glowfen and Nine Dragon Stack open on their newest builds, with no extra reload on the way in.
- Release checks wait their turn for the graphics card, so their timings read true.

## v0.1.90 (2026-11-25)

- The cook stays within its memory while it lists a large store, so new zone uploads keep cooking.

## v0.1.85 (2026-11-24)

- The title screen answers ENTER ZONE at once, the zone picker swipes full screen, and an idle title hands over again.
- Clicking just beside a person starts the talk, and creatures you fell on the grid can be harvested.
- Music keeps playing while the Bag is open.
- Phones show the storm badge and pickup line in a tidier HUD, and keep the sharper High look on capable phones.
- A world map at full fit no longer crowds the view with zone names.

## v0.1.84 (2026-11-24)

- Lights in a zone can now brighten step by step as a quest moves along, starting with Glowfen's shrine lanterns.
- Nalati Grasslands supports the updated night guest encounter, with the same creature looks and animations.
- Saved gear from older versions carries over to the new item names, so nothing goes missing from your hands.
- Ammunition always finds the weapon it belongs to after an update.

## v0.1.81 (2026-11-24)

- Older published revisions of Driftwood, Pine Hollow and Nalati Grasslands load in online play.
- Clients from before the wire upgrade prompt players to update before joining.

## v0.1.67 (2026-11-21)

- Mirror Salt shows the dock prompt at seat height and lets drivers get back into their buggies.
- Mossgate Hollow shows its completion card.
- Pine Hollow gets its latest creatures and encounters.
- Choosing a zone moves your online seat there, even when the server is still holding your previous seat.

## v0.1.64 (2026-11-21)

- Nalati's new eagle and balbal can use their authored bodies and coats.
- Cooked creatures keep their coat textures after their first draw in Safari.

## v0.1.63 (2026-11-21)

- Explorer textures stay visible as you switch between specimens.
- Fixed a Chromium loading hang when reusing a prefetched download.

## v0.1.62 (2026-11-21)

- Grid cells keep less data in memory while you explore.

## v0.1.61 (2026-11-20)

- Driftwood Isle's drowned sailor returns in daylight, so later arrivals can earn the hold key.

## v0.1.60 (2026-11-20)

- Nine Dragon Stack shows its lanterns, stalls and portal when you enter from the road.
- Boss health bars appear when you enter Far Reach or Sunscar Dunes from the road.
- Pine Hollow loads its new revision.

## v0.1.59 (2026-11-20)

- The grapple claw is available when you enter Nine Dragon Stack from the road.
- Driftwood Isle loads its newest revision.

## v0.1.58 (2026-11-20)

- Nine Dragon Stack's grapple is back in the loadout.
- Shard audio prepares correctly on Linux.

## v0.1.57 (2026-11-20)

- Nine Dragon Stack, Sunscar Dunes and Pine Hollow now run on the new zone format.
- Declared creatures load when you enter a zone from the grid.
- Swords land hits in Driftwood, Pine Hollow and Nalati when you enter from the grid.
- Voices no longer stutter on a cold first load on phones.
- Shard uploads recover from temporary storage errors.

## v0.1.54 (2026-11-19)

- The title Settings menu keeps its own layout when the Bag uses the new sheet.
- Phone dialogue sits above the controls. A normal reconnect after switching apps stays quiet.
- The Bag and minimap use the same zone map, with clearer overview labels and zoom centred on the player.
- Brasscap Mesa rev 13 adds the arena ammo cache. Vibrato ends with its note. Players can no longer push through each other head-on.
- Driftwood preserves a jump pressed while stepping onto the shrine ledge. Format 0.55.2 keeps the Captain's declared encounter fields.

## v0.1.53 (2026-11-19)

- Brasscap rev 12 brings tracers, muzzle flash, impact dust, reload animation and updated Wyrm timing.
- Dunes can load the new shard format. Runtime plans support declared owner bosses.
- The launch screen shows slow startup, and returning to the app gets a brief quiet reconnect window.
- Zone Select enters at the spawn, the Bag map opens on the player's zone, and players make soft contact when they run into each other.
- Returning to Sky Reach works after saving at its grid exit.

## v0.1.50 (2026-11-19)

- Brasscap Mesa uses revision 9, with the current Dust Wyrm.
- Grid pages place the serpent along its trail.
- Declared creature decisions can read the nearest player, and the server leads declared rides.
- Kit melee reports which part a blow hit. Reviving a creature restores its parts and break channels.
- The page accepts ownerless runtime plans for declared creature spawns.

## v0.1.49 (2026-11-19)

- Native runtime plans now run the creatures declared by ordinary shard uploads.
- Pine phone textures use both cook encoder lanes and have time to finish a cold cook.
- Declared creatures can hold their spawn, using shard format 0.47.0.
- Recooking a shard keeps its own discovery, descriptor, and recorded programs.

## v0.1.48 (2026-11-19)

- Staging shard uploads cook in minutes again.

## v0.1.47 (2026-11-18)

- Cook phone-ready textures for splat ground and skip redundant splat downloads during phone prefetch.
- Draw the first world frame before warming additional content on phones.
- Keep movement responsive against terrain banks and remove stutter when boosting on roads.

## v0.1.46 (2026-11-18)

- Load the skin rigs used by spawned creatures.
- Predict motion while steering the land-sail.
- Release a parked vehicle when its rider steps off.

## v0.1.42 (2026-11-18)

- Show the race clock in Mirror Salt when starting a race from its grid cell.
- Update Brasscap Mesa to revision 6.

## v0.1.41 (2026-11-18)

- Keep the title steady while Enter the MMO is opening.
- Resume in the same spot after a graphics reset.
- Hide the gray-box Template prototype from player Zone Select.

## v0.1.40 (2026-11-17)

- Updates are faster for players with older cached builds.
- Return to your zone after an update.
- Includes Brasscap Mesa revision 4.

## v0.1.36 (2026-11-17)

- Progress resets once before the MMO opens; sign-in and settings carry over.
- Older clients update once to the new progress epoch.
- Fix mobile sign-in closing immediately after its opening tap.

## v0.1.35 (2026-11-17)

- Keep Template coins and goods when leaving and returning to a room.
- Enter worlds from the new main screen with a detailed loading card.
- Find every placed upload in Shard Select and load its far view reliably.
- Keep a racked sword equipped after reloading the world.
- Sign in through a mailed link and keep online world recovery in the world.

## v0.1.34 (2026-11-17)

- Fix repeated Template whip attacks and melee hits on large enemies.
- Keep kill credit with each player and correct zone names on the minimap.
- Prepare newly published zones before a staging release goes live.

## v0.1.33 (2026-11-16)

- Fix Pine Hollow loading and world entry.
- Correct ammo prompts and serve packs from the CDN.
- Keep release checks inside their assigned CPU budget.

## v0.1.32 (2026-11-16)

- Settings opens from the title screen on phones and desktop.
- A brief connection drop while loading a world recovers when the connection returns.
- Forced updates return quietly to the title screen.
- A busy frame no longer triggers a false reconnect message.
- Loading offers retry and connection help when the world’s address cannot be verified in time.

## v0.1.31 (2026-11-16)

- Restore reliable world entry and full-screen loading from Shard Select.
- Prevent Pine Hollow from crashing while loading wildlife.
- Refresh old Home Screen installs and show loading progress sooner.
- Improve the world cards and version shown in Shard Select.
- Improve arrival and movement when crossing between zones.

## v0.1.29 (2026-11-16)

- Enter neighboring zones through their gates without a page reload.
- Restore detail layers and solid Mossgate lifts.
- Show the sword rack prompt in the shared world.
- Improve movement smoothing and release build speed.

## v0.1.28 (2026-11-16)

- Worlds prepare from the title screen without a full-screen loading card.
- Coin rewards from the updated shards save without crashing.

## v0.1.27 (2026-11-16)

- Creatures in newly uploaded shards drop the coins their loot table specifies.
- New uploads start cooking while older shards warm, so authors see them sooner.

## v0.1.26 (2026-11-16)

- Newly uploaded author shards finish loading when you enter the world.

## v0.1.25 (2026-11-16)

- Forced updates explain why the browser needs to reload.
- Tree sets keep their intended detail ranges.
- Creature combat shows health bars and hit reactions; Brasscap uses calmer ground camps.
- New creator uploads reach the cook worker without restarting it.
- Authoring tools load installed engine packages on Node 26.

## v0.1.24 (2026-11-15)

- A phone holding an old version no longer sits on "still waiting": the new version takes over by itself, even on bad Wi-Fi.
- New versions download in the background while you play and switch in on your next visit, never as a reload in the middle of a game.
- Reloading keeps you on the page you were on, such as a shard's own link, instead of going back to the main menu.
- When the title's loading bar stalls, it says what it is waiting for, and tapping reload fetches a fresh copy past the cache.

## v0.1.23 (2026-11-15)

- New and updated shards are cooked for the world again: since Saturday the cook refused every upload as over its space.
- Lamps carried by players and creatures move their light with them, and the 16 nearest lamps light the scene.
- Brasscap Mesa keeps its far view from the road, and a shard's creatures respawn where they were placed.
- You can take a melee weapon from its rack, and creatures in a shared shard stay in their own cell.
- The game's files now come from our content network, so the page is smaller and loads faster, and cached files survive a release.

## v0.1.22 (2026-11-15)

- Brasscap Mesa: you walk in with the lever-action in hand, its rack restocks your rounds, and every bandit and beast in the cell is drawn.
- A shard placed on the grid after a release keeps its road speed limit on the server too.
- When the world's files fail to download, the game says so and offers Try again instead of waiting forever.
- Reloading for a new version brings you back into the game rather than to the title.
- Behind the scenes: the server swaps out a stuck or drained worker without dropping players, and the cook follows staging by itself.

## v0.1.21 (2026-11-15)

- The hoverboard is faster online too: 14 m/s in a shard and 30 on the road, and boost is four times that (56 and 120).
- The HOVER tab says BOOST while boost is on.
- When something fails, the game says why and retries by itself: release reads, paused downloads and voice, which has Try again.
- Moving between shards is steadier on phones, and the grid waits for room before it loads a neighbour.
- Behind the scenes: agents now move the server's cook to each new release themselves, so a release needs no hands from Jake.

## v0.1.20 (2026-11-14)

- Big desktop screens stay smoother: the game drops its render sharpness a step when frames run slow and raises it again when there is room.
- Walking into the next shard is faster: the shard ahead loads first, and you no longer freeze at the edge of a shard while it builds.
- Glowing parts of a shard, like lamps and lit windows, glow again in the new looks.
- A small chip tells you when your connection is slow or unstable, and coming back after a long time away shows a welcome back card.
- Behind the scenes: the server spreads busy shards across its workers by how much work each one costs, and its monitoring works again.

## v0.1.19 (2026-11-13)

- Mossgate Hollow and Brasscap Mesa have new looks: sunset sky, warm lamps, mossy stone, and a beach edge on Mossgate's pond.
- Walking from one shard into the next no longer stops at a loading wall: the shard ahead warms up while you are on the road.
- The game keeps playing through a dropped connection, loads from cache offline, and reconnects once you are back online.
- Far Reach is on its third version with docks at its exits, and the map tab no longer breaks on a missing tile.
- Behind the scenes: shards can ask for mirror water, lamp halos, glowing motes and exposure; the server reports to monitoring.

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
