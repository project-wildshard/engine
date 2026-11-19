# Import the authored road width in the hosted hover proof

Hosted v0.1.47 source qualification reached the real grid movement test and
rejected its easing point. The proof still read `ROAD_WIDTH` from engine
config after that export moved. Read it from the format module the grid uses,
so the proof exercises the same midpoint with the 22 m/s cap and 88 m/s
boosted speed it already expects.
