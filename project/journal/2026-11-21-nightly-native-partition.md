# Run the cold native files on one worker

Pine's setup took 10.109 seconds in nightly suite 2 in 44910987109.
The existing serial rehearsal on that same build ran every route and
opened the worker in 5.206 seconds.

Nightly now requires a fourth receipt for the three recognized native
contention files. The other three jobs run their ordinary files.
Each case runs in exactly one qualifying partition, with its existing
deadline and assertions.
