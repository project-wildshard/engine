# 2026-11-18: creatures say if a weapon hits (ONE-FORMAT OF38b)

opus-of-m7b. Engine pins shard-format 0.38.0 (from 0.35: the 0.36/0.37 memory ratchet and phone skin need no engine
change). `installDeclaredAttackable` answers `damage.admit` on the declared path: a player's blow on a creature whose
species `attackable` row refuses that weapon class (ranged = a weapon row with a `ranged` policy or a bow/firearm
profile, else melee) or whose memory holds a shielding state is refused. Creatures' and the world's blows pass.
