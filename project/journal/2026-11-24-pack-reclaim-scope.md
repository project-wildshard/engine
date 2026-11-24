# Reclaim only the cook's objects

The v0.1.78 staging placement file disappeared from the shared packs
bucket. A regression test reproduced its deletion by the old collector.
The current cook journal did not attribute the live deletion.

Keep signed documents and other owners' keys out of the cook's budget
and both collection paths. Match the cook's index, loose and spawn pack
names. Kept indexes and a fresh retired-build index still survive.
