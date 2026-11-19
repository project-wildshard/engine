# The session chunk's soft cap rises with two creature features

Main run 44464496865 (dd525e4bda..1966830422) failed `boundaries`: the
session chunk read 4,400,336 B raw against its 4,400,000 cap in
`lint/ratchet.json`, and the next run, on 725bcd0e, read 4,400,676. Gzip
stayed under (1,359,896 of 1,361,500).

The growth is content. 821a3c64 ("the horizontal biped's tail") adds 32
lines of skin pitch to `clientSkins.ts`, and 725bcd0e ("show the running
strike's tell") adds the strike tell. J438 and J439 say a feature
raises the soft cap in the same commit, to the measured size plus
J431's margin. The measured size is CI's 4,400,676 B. The margin is
J431's 2%; its 5 MB floor is a memory-gate floor, larger than this
whole chunk, so it is not applied. That gives 4,488,690 B.

No hard cap exists for this budget yet; FS21's budget files will carry
one. A local build reads about 1.2 KB under CI's (4,399,467 on
725bcd0e), so CI's number is the one used.
