# SR11 (C8, C9): a data shard's kit melee and lantern run on the server

Before the flip the page stepped each declared item's runtime. The flip
left that runtime queued and never stepped: a data shard's player struck
with the zero-damage `HOST_PROBE`, and the lantern never lit or burnt.

The data cell now gives each player their own runtimes for the
`kit.melee` and `kit.lantern` rows (`declaredKitItems.ts`, a player
seat each, joined so an older save still restores). The wire carries
what it already could:

- a press is the command's `attack`, its direction the page's look and
  its origin the server's own eye, so a client names a direction, never a
  place; the heavy bit on a press is the heavy blow, and a held heavy
  charges and strikes on release;
- an `equip` act picks the kit weapon by its order among them
  (`declaredKitSlots`), which `held` reports back as for any slot;
- a lantern toggle or refill is an `interact` act naming its item scene.

A hit carries its command's seq, so the page confirms it as its own and
counts the kill. A seat's item tick never stands ahead of its host's, so
a player document carried into a younger room (E7.4) steps on. The lantern's `itemFields` go out as owned lines, a
name and a number with oil in thousandths, so no wire format changes.
A line at zero is dropped from `owned`, so the page reads an absent item
line as zero once a wire is up.
The page mirrors those lines into its unstepped runtime, which is what
the held lantern's light and the oil meter read.

Left out: the whip heavy's poison. No server owner applies status
effects yet; the page's EffectService was the only one. The blow lands,
its effect does not. The lantern's `tool.used` cue also stays quiet, as
the page no longer sees the edge.

Proof: `split-repair-proof --only=data-shard` (Template by its hidden
URL): real whip presses (five) kill the small blob through the server,
LANTERN lights it, its oil line and meter fall over four seconds, then
Big Blob's bar and retry as before. `test/declared-kit-items.test.ts`
covers the strike, the swap, the heavy, the burn and a save round trip.
