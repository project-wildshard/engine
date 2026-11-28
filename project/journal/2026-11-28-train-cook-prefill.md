# The train cooks a moved cook hash before local QA

> Written by: Claude (opus-ship2)

v0.1.103's train held at local QA: "No cooked index for brasscap-mesa". Main's cook hash moved to 0525a4ee (SF23's
validator change, declared same output as 9042bac8), and the staging page build reads every pinned zone at the cut's
cook, which the staging cook only writes at go-live. v0.1.102 passed because a lane had prefilled 1.21.0 by hand
(PV26). The hand scripts never passed `sameOutputFrom`, so they recooked everything.

`src/scripts/cook-prefill.mjs` now does it: it reads each pin's index from cooked.wildshard.io and cooks only the
missing ones, carrying a same-output donor after the worker's proof cook. The train runs it from the cut before local
QA with `~/.config/wildshard/cook.env`; without the keys it refuses and names the command. For v0.1.103 it carried all
27 zones from 9042bac8. Meta QA 11-26 row 92.
