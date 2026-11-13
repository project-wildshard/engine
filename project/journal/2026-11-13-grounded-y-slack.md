# Standing on the floor, a few cm of Y is not a miss

NET-LAG NL12, part (a). The predictor corrected on any gap over 2 cm in
any axis, Y included. On the ground the ground decides Y. A server and a
client a few cm apart in Y only, both grounded and level in XZ, stand on
the same floor, and the correction just rubber-banded the feet. NL10
removed the drift that made those gaps. `GROUND_Y_SLACK` (5 cm) keeps a
future one from showing: when both sides say grounded, a Y gap within it
counts as zero in the compare. XZ, the air, a grounded mismatch and a
gap past the slack all still correct.

`test/net-predict-gentle.test.ts` was red first on the 3 cm case; the
control cases (0.3 m in Z, 3 cm in X, airborne, 20 cm) pass on both
sides. Parts (b), the glide time scaled to the offset, and (c), NL5's
under-floor guard cited, stay with the row.
