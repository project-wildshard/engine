# A ranked spawn is a stronger version of its creature (ONE-FORMAT OF33b, OF29c)

- A declared spawn row's `rank` (shard-format OF28a, OF33a) now reaches the simulation. The engine reads the format's
  own table (`@wildshard/format/creatureRanks`), the one its size cap reads, so a shard only names the rank.
- Hp and size scale before the level is built (`rankCreatureSpawns`), so a save and its restore build the same bodies;
  a counted row's copies carry its rank. Every blow a ranked body lands takes its rank's damage (`installDeclaredRanks`,
  one `damage.modify`, whatever strike or ability lands it). Its loot rolls its rank's count of times, paid as one
  bounty (`loot/personal.ts`); a once-only item still falls once.
- An unranked row keeps its own numbers and bytes. Pine's `population.elites` and Nalati's `riding.elites` join at M8.
- Proof: `test/declared-ranks.test.ts` (a champion wolf: hp x10, size x1.35, bite x2, 5 coin rolls; a veteran pack's copy).
