# Keepsakes in a room (SERVER-PARITY HS4)

- Red first in `test/net-keepsakes.test.ts`: charms (SS3b) and trophies
  (personal loot filings) were already in the server's book; only the
  captain's hat's auto-wear was page-local, so the server's worn effect
  never counted and a reconnect lost it.
- The page now only mirrors in a room: `takeKeepsake` (shared law) sends
  the wear act unless the server's line says it is on, reward toasts are
  told once past the first frame, and a restore pickup pays nothing in a
  room (decided at take time: the wire can bind after install, review).
