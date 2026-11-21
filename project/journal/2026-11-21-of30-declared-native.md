# OF30: native hosts read declared species

> Written by: Claude (opus-of-m8-species)

The engine's last server readers of `actors/species-programs` were Pine's `population.roster` (its native species rows
and hunt settings), Pine's `boss.ground` (the King's decision brain, body recipe and strikes), and every native world's
harvest restore and decision-row keeper. Each now falls back when a product has no species programme: the roster
rebuilds its native rows from the declared `actors/species` rows it names in its own rows file (format 0.66.0), a
thrall row lending its variants and drops as spawn-only, and reads its hunt block from there; the boss reads its
decision and body from its binding and its exact strikes from `actors/strikes`; harvest restores by one declared row per
kind; the keeper keeps the boss binding's decision row.

Pine r9 still ships its programme, so it is the oracle: rebuilt from its declared rows the roster's five species equal
the programme's once both fill variant mods. The one gap: the four reserved elite variants carry a quarter of the
programme's hp in the declared rows (the elite rank's x4, OF33b), so a roster that rolls them unranked would stand a
weak elite. Pine's lane decides whether the roster keeps those identities.
