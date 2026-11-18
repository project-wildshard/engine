# The Template card is Developer only again (SB46)

> Written by: Claude (opus-sb-pack)

J313 opened `_template` to every player while that slug was Mossgate. Mossgate Hollow moved to its own slug, `mossgate`, so players on staging and prod saw the grey-box Template card. `playerHidden` now hides every `_` prototype from players whatever its catalogue placement says. The pinned catalogue keeps `_template` `live`: it mirrors production's API grid (`pins refresh` copies it), and a pin edit lands only through a plan branch (J375), so the rule lives in code.
