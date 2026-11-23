# OF30g1: Nalati draws with no hull book (opus-look1)

Nalati's species catalogue now takes its packed bodies from `actors/sheep.json`'s presentation (the same compact rows the
hull book carried) when the product ships no `look/hull-book`, and its flock names its own `*.rigged.glb` instead of a
`look/rigged-hulls` family. Every other hull kind becomes a declared skin in the shard (OF30g2), so the catalogue's
`catalogueSkins` replace every look's body and skin. Old products keep their sections and draw as before.
