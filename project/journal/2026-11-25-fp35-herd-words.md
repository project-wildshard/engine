# The discovery document's herd words are no longer read

- FORMAT-PRUNE FP35: herds and species moved to declared rows (ONE-FORMAT
  OF9b4), and format 0.1.0.6 drops `species`, `spawns` and `faunaTuning`
  from every copy's discovery mount (fp36). The engine stops reading them
  from an authored discovery document and drops the level's `faunaTuning`;
  declared species rows keep their own tuning. A manifest's `species` stays
  as the engine's own list, which a declared product fills from its rows.
- It waits for production to read 0.1.0.6 copies: production's 0.1.0.4
  open plots still name their herds in the discovery mount, and this
  release would drop them there before the format move does.
