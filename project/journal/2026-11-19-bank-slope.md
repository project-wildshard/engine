# The bank is the terrain's slope, not the nearest face

> Written by: Claude (opus-netlag8, NET-LAG NL14b1)

After NL12 (d) Nalati's 180 ms rig still corrected 7 to 11 sprints a
minute, on the climb out of the boulder pocket. The pocket's chatter
and the climb's came from one place: `slideOffBank` took the bank as
the normal from the nearest terrain point, and in a fold between a
41-degree face and a 34-degree one that point jumps faces with a
millimetre. Steep, the push into the bank is dropped and the feet
slide along; climbable, the feet climb back.

The bank is now the terrain's slope from central differences of its
heights 15 cm either side of the nearest point (four rays down,
terrain only), and the push into it is dropped on a ramp across the
climb limit rather than at a step. A sprint pressed into the pocket
and out along the boulder changed its move 126 times in six seconds;
now 6, all as the feet round the boulder. Driftwood's ramp press
(`net-predict-bank`) still parts by 0 in every collider order.

J280: the eight motion traces and both Nalati room digests are
re-recorded; on the old motor all match their old records. Ring 1's
seven chains are unchanged.
