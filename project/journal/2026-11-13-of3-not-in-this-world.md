# OF3: a shard the world doesn't open isn't entered on a world build (opus-of3)

- J298 (Jake, 2026-11-12): world builds play online only, so ba88ac9a's "unplaced plays solo" is gone (OF2), and a one-shard page
  of a shard the world doesn't open would be seated in another cell. OF3 stops it before it loads.
- The rule (`oneWayIn.ts` `inThisWorld`, `worldOpens`): on a world build a shard is entered only when the catalogue places it and the
  world's word, when it names shards, names it. The word is the one heard on this page, else the device's kept one: `gridRoute` (OF0's
  route memory, one store) now keeps the word's `shards` beside `grid`. No word and nothing kept leaves the catalogue's answer (J300).
  A build with no world (preview) opens every card.
- Shard select: such a card is dimmed with "Not in this world yet" under its name, ENTER WORLD reads the same and is off, and EXPLORE
  WORLD is off too (exploring joins the world as well, OF2). A `?chunk=` page to it (a bare link, a harness URL or a tap) lands on the
  title with "<name>: Not in this world yet", checked before the title-first rule (kept word) and after the one way in (a word just heard).
- Choices taken without Jake (reversible): the deck reads the kept word only and never dials the door itself; a kept word that is
  stale (the world opened more since) refreshes the next time any open shard is entered. Since J305 Brasscap, Pastel Plain and Ink &
  Cel are grid cells, so on staging (all 25 hosted) only Thin Ice and Desert Ruin are closed by the catalogue; prod's two-shard word
  closes the rest there.
- Proof: a local staging-like build, a stand-in door whose word names only Driftwood and Nalati, Developer on, headless Chromium.
