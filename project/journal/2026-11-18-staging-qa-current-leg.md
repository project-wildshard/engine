# SQ21 report the current staging QA leg

The v0.1.46 live runner passed K3 and K5 with no findings. Saving the
verdict also added retained candidate rows to the object returned to the
release train. The train read those rows as live work and wrote a false
HOLD. Retained rows now go only into the stored verdict. The QA result
names its current leg and has an explicit pass or hold status.

The regression saves a candidate and then a live leg for the same build.
The archived verdict keeps both and the live verdict still has two rows.
