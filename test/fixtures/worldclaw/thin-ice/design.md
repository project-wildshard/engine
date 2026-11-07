# Thin Ice · design.md (the fjord dry run in T1's formats: L1's first fixture)

## Vision (P1, Jake, verbatim)
"a frozen fjord where you are the last ferryman"

## The pitch (P2: C · Thin Ice)
The ferry is gone and the fjord has frozen. Race the ice on a sled-board, fast and fragile, and find the village that
drowned beneath it.
- **Pillars:** moment: skating over clear black ice and seeing the drowned roofs below · session: chart a new route
  across the ice before it cracks · return (note): new cracks each visit.
- **Verb:** the kit hoverboard as a sled-board (existing; the HOVER button). No P7.
- **Weapon:** the harpoon (custom; light jab, heavy throw-and-reel).
- **Roster:** ice bears (kit bear, restyled) · ice crawlers (new, packs of 3) · the Bellkeeper (boss).
- **Antagonist:** the cracking ice; the Bellkeeper keeps the drowned bell, and the bell's toll cracks the bay.
- **Look:** Aurora, kept simple (`style-bible.md`). P4 approved in full; the eel may show on the spire as its silhouette.

## Places (11; the fjord layout, `../fjord-spec.json`)
| id | Place | Role | Beat |
|---|---|---|---|
| spawn | South Landing | spawn | wake on the jetty; Sigrun's lantern points across the ice |
| hub | Ferryman's Village | hub | Sigrun gives the harpoon; the trader; the old ferry winch |
| lighthouse | The Lighthouse | landmark | climb the outside stair; the beam reveals the drowned street grid |
| wreck | The Drowned Spire | boss | the Bellkeeper uncoils; the bell tolls; the arena ring cracks |
| icecave | The Ice Cave | secret | a hidden crack into the glacier; the frozen chapel and its bell rope |
| tower | Signal Tower | objective | relight the brazier: the first safe route across the bay lights up |
| quarry | The Old Quarry | arena | the crawlers' nest: blocks for cover, two exits |
| glacier | Glacier Mouth | objective | follow the crawler tracks to the seracs; the bell's clapper in the ice |
| spring | Hot Spring | camp | rest; the open water hole shows the drowned church's door |
| overlook | Cliff Overlook | vista | the whole bay; the drowned village traced under the ice |
| ropeline | The Bay Run | traversal | the flagged sled lane; pressure ridges to jump |

## Happenings
- **The drowned bell tolls** (signal: ripples and a ring of cracks; seen from the overlook and the hot spring).
- **A crack races across the bay** (signal: a white line and a boom; seen from the village and the landing).

## Critical path (a gated loop)
landing → village (harpoon) → signal tower (route lit) → bay run → quarry (crawlers) → glacier mouth (the clapper) →
ice cave (the bell rope) → lighthouse (the grid revealed) → the drowned spire (the Bellkeeper) → village.

## Routes (typed legs)
walk: landing–village, village–quarry, village–tower, lighthouse stair · sled (hover): the bay run, village–spire,
spire–glacier · walk: glacier–ice cave.

## The session slice (P9)
landing → village → signal tower → the bay run → the quarry fight (10–15 min).

## Verdict log
- P1: "Go with the sentence".
- P2: "C · Thin Ice".
- P3: "Which one is the easiest to implement. I like aurora but I want one that's the most simple and technically
  feasible" → "Aurora, kept simple".
- P4: "Approve all four" ×3, "Approve all", "Eel on the spire is fine".
**Jake's P5 pick (2026-10-01): map A** ("They all look the same lol. I guess A").

## Jake's notes on map A (wave 1, 2026-10-01) → the revision
- Leaning A. The lighthouse is painted at the top-centre point, not at its pin → the pin moves to the painted spot; a
  clear causeway, not a tiny bridge.
- **Every shard has access on all four edges** (W, E, S, N) to the other shards → four clear entry roads.
- South Landing "is a complete mess because it's trying to be a bridge" → a clear landing on land at the south edge,
  with the south entry road.
- The quarry: fine, needs a better access road.
- The village: great, lots of detail.
- **The boss must not be fought by accident** on the way from the village: the Bellkeeper sleeps under the ice; the
  spire is a passive landmark; ringing the drowned bell (a late quest step) summons it above the ice.
- Ice cave, spring, lighthouse: okay. A3 showed a second lighthouse (a lookout tower) that doesn't exist: remove.
- "The three views are not internally consistent … codex is imagining little features" → the views come from one 3D
  blockout of the map, rendered from every angle and painted over (Jake: "3D blockout, painted").

## Jake's notes on revised map A (2026-10-01) → revision 2 (not yet made)
- From the south: village and quarry fine; the entrance shows, but "it's not clear exactly where I start" → mark the
  spawn clearly.
- "The village needs a bit more detail and a bit more planning" → a village plan (streets, the square, Sigrun's house,
  the trader, the ferry winch).
- "Walls through the ice, that's wrong … no cliff walls on the ice, like the ice should be flat … no rocks or cliff on
  the ice, just flat"; the spires come out of the ice. (Cause: the blockout drew ice lanes as brown road stripes.)
- "The fjord's completely gone, so we need to add the fjord back" → the long narrow inlet between cliffs, open water at
  its ends.
- "The quarry should be a pit … goes down into the earth", not blocks.
- The glacier mouth reads as "a construction site … a bunch of blocks behind the glacier" → a real glacier tongue.
- Spring, forest roads, lighthouse: fine. "These eight mock-ups are nowhere near consistent. But that's fine … this is
  enough feedback."
**Jake (2026-10-01): "Map A revision 2, it's approved."**

## Wave 2 (P6), 2026-10-01
The 11 first-person views framed on map A revision 2 (cameras from cam_pick.py + six set by hand; each prompt lists what
the camera sees from the map's coordinates; five use the blockout render as a composition guide). Picked GO in the question tool, then: "Let me review the images lol bro": the GO is held until his review.

## Jake's review of wave 2 (2026-10-01)
- Keep: 1 South Landing, 4 the quarry ("looks great"), 6 the ice cave ("fantastic"), 8 the bay run, 9 the signal tower.
- 2 the village: "the lighthouse flipped … rendering a lighthouse to the right of the spire when the lighthouse is to the
  left of the spire in the first image. So that's not internally consistent."
- 3 the lighthouse: "the stairs going up the lighthouse are completely junk … don't spiral around the lighthouse
  correctly"; "some kind of village on the far edge … I don't know where that village exists".
- All views: "The minimap is wrong in all of the renders." → composite it by code from the approved map.
- All views: "there's no pathways on the ice … we need to add those back."
- 5 the spire: "needs more … the start of the boss battle … a tiny spire"; under the ice it shows "a reflection" instead
  of the rest of the spire; "I must be standing somewhere else"; "the spire needs to be bigger … a boss arena, nice and
  bigger".
- 6 the ice cave: no buildings under the ice there; "the village under the ice should only be near the boss".
- 7 the overlook: "a gigantic village underneath the ice … a lot of copy pasta … way too big"; the spire bigger.
- 10 glacier mouth: "doesn't look particularly impressive … You're supposed to be able to go somewhere … a lot more
  thought needs to go into the glacier mouth".
- 11 the hot spring: "can be bigger … it looks like super tiny".

## Content (D70, D71), 2026-10-01
- Jake: the dry run reviewed only images; the content (quests, journey, why the player goes, side content, the slice)
  was drafted unseen. The drafted journey zigzagged across the bay nine times.
- **Structure: C · lights open the ice** (Jake). The ice is unsafe until the old beacons burn; each lit beacon opens a
  glowing lane and a region: stage 1 the south lane (signal tower), stage 2 the north-east lane (the glacier beacon,
  climbed onto the glacier), stage 3 the west lane (the lighthouse), then the centre lane to the cathedral-scale spire.
- **Unsafe ice, technically: "Thin ice cracks", confirmed by Jake** ("Thin ice, that was me. I approved it."). The first "Thin ice cracks" was submitted by a herdr broadcast's Enter from the Codex agent sol-x2b (21:23:44.7Z), not by Jake ("I did not choose thin ice cracks"). The re-ask's answer was his. The mechanic: the ice stays a normal walkable collider; a thinIce mask (2 m
  cells) in the world data marks unlit ice; each fixed step, a player on thin ice outside a lantern's radius builds a
  crack timer (cracks + sound at the feet); past ~3 s they fall through, fade and respawn at the last safe point; a lit
  beacon flips its lane's cells to safe; unlit ice reads dark and wet, lit ice thick and white with lantern posts; a
  fast sled skims ~1 s longer (a feat). No walls.
- Glacier mouth: climb onto the glacier (switchback trail, rope ladders, crevasses; the clapper in a crevasse).
- The spire: cathedral scale (~40 m), a ~60 m ring of cracked ice as the boss arena; the drowned village only around it.
- Each quest step is a 2x2 board (D71): content-c steps 01–12 in out/steps/.

## Jake's review of the content boards (2026-10-01)
- 1 South Landing: yes. 3 the quarry: yes. 5 the signal tower: yes. 7 the glacier climb: "looks really fucking cool".
  10 ringing the bell / 12 home: make sense. Side quests, feats, keepsakes, happenings: yes.
- 2 Sigrun hands over the harpoon: "a new type of animation … for these characters to … actually move, animate, and
  interact with you in a first person thing … this feels like a cutscene, and we have no cutscenes in the engine."
  → an engine gap (NPC interaction / cutscene).
- 4 the old ferry line: "the ice can only be crossed when you interact with the rope … press some kind of button to
  start grabbing the rope and that's the only safe way to cross the ice. I think that's a cool idea." → a rope-grab
  traverse: holding the rope, thin ice doesn't crack.
- 6 the cliff overlook: "I can't remember what the point of going to the cliff overlook is … doesn't say what the point
  was other than to look." → it needs a purpose.
- 8 the crawler queen down in the crevasse, then back up to light the beacon: "visually jarring … But I guess that works."
- The sled: "only when unlocking the sled, you can go over the ice … a really cool, like, item-specific way of going
  over the ice"; "the hoverboard can't be equipped on the ice … the game just kind of tells you … the hoverboard doesn't
  work on ice". → a surface rule: the hoverboard is refused on ice, with a message; the sled is the ice tool.
- 10 the ice cave: "the opening is nowhere near big enough. It needs to be a bigger opening."
- 11: the spire is huge in one image and small in the next two (mockup inconsistency, D72); it stays cathedral-scale.
- Enemies: "cool to try a shard where we don't pump it full of enemies … only ice crawlers, the mini boss, and the
  bears … very few pockets of enemies on the map." → sparse enemies: the content is traversal and discovery.
- Jake's answers: **the sled rides lit ice only** (fast, but each beacon opens new sled lanes; unlit ice is rope or
  nothing); **the overlook is a survey** (looking out marks the two dark beacons, the spire and the ferry wreck on the
  map and minimap); **build the NPC moment** (a small engine feature: an NPC plays a scripted gesture, the camera holds,
  an item lands in your hands; reused by every shard; a cost row).
- Engine note (2026-10-01): E357 G5 landed the attack-disc relabel on main (`6eeca4e3`, touch.relabel.r0, scoped
  label/icon restore). The rope's GRAB / LET GO uses it, so that part of step 4 is existing engine, not new.
- **Jake on content round 2: "looks reasonable to me. It's like a start."**

## The machine block (T1, R15)

```json worldclaw
{
 "slug": "thin-ice",
 "scope": "full",
 "places": [
  {
   "id": "landing",
   "role": "spawn",
   "name": "South Landing",
   "beat": "arrive at the spawn beacon; a lantern burns in the village"
  },
  {
   "id": "village",
   "role": "hub",
   "name": "Ferryman's Village",
   "beat": "Sigrun's lantern house, the trader, the ferry winch"
  },
  {
   "id": "lighthouse",
   "role": "landmark",
   "name": "The Lighthouse",
   "beat": "beacon 3; a spiral stair to the gallery"
  },
  {
   "id": "spire",
   "role": "boss",
   "name": "The Drowned Spire",
   "beat": "cathedral scale; the drowned village around it under the ice"
  },
  {
   "id": "cave",
   "role": "secret",
   "name": "The Ice Cave",
   "beat": "a big cave mouth in the west cliffs; the frozen chapel"
  },
  {
   "id": "tower",
   "role": "objective",
   "name": "Signal Tower",
   "beat": "beacon 1, timber, on the east headland"
  },
  {
   "id": "quarry",
   "role": "arena",
   "name": "The Old Quarry",
   "beat": "a terraced pit with a ramp and a crane"
  },
  {
   "id": "glacier",
   "role": "objective",
   "name": "Glacier Mouth",
   "beat": "beacon 2: the ice cliff, the switchback trail, rope ladders"
  },
  {
   "id": "spring",
   "role": "camp",
   "name": "Hot Spring",
   "beat": "the steaming pool and the hunter's camp"
  },
  {
   "id": "overlook",
   "role": "vista",
   "name": "Cliff Overlook",
   "beat": "the cairn and bench; the survey"
  },
  {
   "id": "bayrun",
   "role": "traversal",
   "name": "The Bay Run",
   "beat": "the lit sled lanes across the bay"
  }
 ],
 "happenings": [
  {
   "id": "bell-tolls",
   "name": "The drowned bell tolls",
   "seenFrom": [
    "overlook",
    "spring"
   ]
  },
  {
   "id": "crack-races",
   "name": "A crack races across the bay",
   "seenFrom": [
    "village",
    "landing"
   ]
  }
 ],
 "npcs": [
  {
   "id": "sigrun",
   "name": "Sigrun, the last lamp-keeper",
   "place": "village"
  }
 ],
 "enemyZones": [
  {
   "id": "quarry-crawlers",
   "species": "ice crawler",
   "place": "quarry"
  },
  {
   "id": "glacier-crawlers",
   "species": "ice crawler",
   "place": "glacier"
  }
 ],
 "elites": [
  {
   "id": "crawler-queen",
   "species": "ice crawler",
   "place": "glacier"
  }
 ],
 "boss": {
  "id": "bellkeeper",
  "name": "The Bellkeeper",
  "place": "spire",
  "summon": "ring the drowned bell (quest step 11)"
 },
 "quest": [
  {
   "n": 1,
   "id": "step-01",
   "title": "South Landing",
   "place": "landing",
   "gets": "",
   "mechanics": []
  },
  {
   "n": 2,
   "id": "step-02",
   "title": "Ferryman's Village",
   "place": "village",
   "gets": "the harpoon",
   "mechanics": [
    "npc-moment",
    "harpoon"
   ]
  },
  {
   "n": 3,
   "id": "step-03",
   "title": "The Old Quarry",
   "place": "quarry",
   "gets": "lamp oil",
   "mechanics": [
    "crawlers",
    "harpoon"
   ]
  },
  {
   "n": 4,
   "id": "step-04",
   "title": "The Old Ferry Line",
   "place": null,
   "where": "the old ferry line, from the village pier across the bay to the signal tower",
   "gets": "",
   "mechanics": [
    "rope-grab",
    "thin-ice",
    "surface-rule",
    "relabel"
   ]
  },
  {
   "n": 5,
   "id": "step-05",
   "title": "Signal Tower · Beacon 1",
   "place": "tower",
   "gets": "the sled-board",
   "mechanics": [
    "beacons",
    "sled"
   ]
  },
  {
   "n": 6,
   "id": "step-06",
   "title": "Cliff Overlook",
   "place": "overlook",
   "gets": "",
   "mechanics": [
    "survey"
   ]
  },
  {
   "n": 7,
   "id": "step-07",
   "title": "Glacier Mouth",
   "place": "glacier",
   "gets": "",
   "mechanics": [
    "ladders"
   ]
  },
  {
   "n": 8,
   "id": "step-08",
   "title": "The Glacier Beacon · Beacon 2",
   "place": "glacier",
   "gets": "the clapper",
   "mechanics": [
    "crawlers",
    "beacons"
   ]
  },
  {
   "n": 9,
   "id": "step-09",
   "title": "The Lighthouse · Beacon 3",
   "place": "lighthouse",
   "gets": "",
   "mechanics": [
    "beacons",
    "beam",
    "sled"
   ]
  },
  {
   "n": 10,
   "id": "step-10",
   "title": "The Ice Cave",
   "place": "cave",
   "gets": "the bell rope",
   "mechanics": []
  },
  {
   "n": 11,
   "id": "step-11",
   "title": "The Drowned Spire",
   "place": "spire",
   "gets": "",
   "mechanics": [
    "bellkeeper",
    "thin-ice"
   ]
  },
  {
   "n": 12,
   "id": "step-12",
   "title": "Home",
   "place": "village",
   "gets": "",
   "mechanics": [
    "npc-moment"
   ]
  }
 ],
 "routes": [
  {
   "id": "south-entry",
   "legs": [
    "walk"
   ]
  },
  {
   "id": "west-entry-quarry-road",
   "legs": [
    "walk"
   ]
  },
  {
   "id": "village-to-the-bay-junction",
   "legs": [
    "walk"
   ]
  },
  {
   "id": "junction-to-glacier-mouth",
   "legs": [
    "walk"
   ]
  },
  {
   "id": "east-entry",
   "legs": [
    "walk"
   ]
  },
  {
   "id": "north-entry",
   "legs": [
    "walk"
   ]
  },
  {
   "id": "lighthouse-causeway",
   "legs": [
    "walk"
   ]
  },
  {
   "id": "west-trail",
   "legs": [
    "walk"
   ]
  }
 ],
 "gates": [
  "E",
  "N",
  "S",
  "W"
 ],
 "slice": [
  "landing",
  "village",
  "quarry",
  "tower",
  "bayrun"
 ],
 "run": {
  "mode": "guided",
  "stage": "P6"
 }
}
```
