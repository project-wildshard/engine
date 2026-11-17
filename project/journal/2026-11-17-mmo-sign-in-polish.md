# MMO sign-in polish (MMO-PLAN MP2.2g, opus-mmo4)

- **The link leaves the address at boot.** A mailed `#login=wsl_…` used to sit in the address until the title built, and the
  boot-timing collector posts `location.href` to the service worker meanwhile (a stale-build reload keeps it too). index.html's
  `data-login-door` script now moves the token into session storage before anything else reads the address; `takeLink` spends it
  from there (the hash is still read, for a cached document from before the door).
- **"Signed in as" once.** A spent link's note repeated the card's own who line; the note is empty on success now.
- **Claims stop once settled.** Every ticketed join ran the claim's transaction (insert, lock, three reads) after waiting up to 3 s
  on the device's save queue. `claimSaves` now answers `moved`/`kept`/`none`; the door remembers accounts that answered `moved` or
  `kept` (they can never take a claim again) and skips them. `none` keeps asking, so a fresh account's later device can still claim.
- **Raw tickets refused** (commit before this): `NetRoom` refuses a `ticket:` player; only the door reads one.

## MP2.3 guest expiry (switch off)

- `saves/expiry.ts`: `expireGuests` deletes `device:` players unseen (`seen_at`, touched by every save and Name claim) for N days,
  with their receipts, saves and place, 500 a transaction (`for update skip locked`). Accounts never expire here (MP2.5's).
- The server sweeps an hour after boot, then every 24 h, only when `GUEST_EXPIRY_DAYS` is set (Jake's switch: it deletes every
  Friends-grid guest idle that long). Boot logs `guests.expiry` with the days or `off`.
