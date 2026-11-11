# Rooms address and the template's cell (MMO-SERVER MS7, v0.1.9)

> Written by: Claude (opus-release19)

- The release named the template by its pin slug, `template`, while the server book, the grid and the server's cells
  all say `_template` (the folder it installs into). With the template in a staging variable the packs gate would
  have held the release ("book has no template"); without it the server opened 24 of 25 cells (GO7). The API can't
  take `_template` (J259 slugs are kebab-case), so the release now names the folder, and either spelling in a
  variable resolves to it. The test runs the server's own `worldCells('grid', …)` over every pin.
- Staging's socket moves to `wss://rooms-staging.wildshard.io`. The bot guard and the two staging proofs accept it
  and the Funnel socket for the one release that moves the address (MS7.3); their `/health` reads stay on the
  tailnet, since D7 keeps `/health` off the public address.
- Open: the Doctor's server row reads `/health` beside the socket. On rooms that is a 404 (D7), so the row falls
  back to "reachable", and the strict staging proof refuses opaque reachability. Either the public address
  serves a small CORS `/health`, or the Doctor learns the server build another way. That's Jake's D7 call.
