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

## MP2.5a account export and delete on the door

- `saves/account.ts`: `exportAccount` hands over the account's player row, saves, receipts and places; `deleteAccount` moves its
  receipts to a fresh `deleted:<uuid>` player named "Deleted" (no tag, empty profile) and deletes the rest, so the ledger keeps
  anonymous rows only. Guests are refused here (they expire, MP2.3).
- `accountRoutes.ts`: `POST /account/export` and `/account/delete` on the door's HTTP server, `Authorization: Ticket <ticket>`
  checked offline like a hello; game origins only (`ALLOWED_ORIGINS`); delete answers 409 while the account is in the world
  (`World.isPlaying`), and a deleted account is forgotten by the claim skip so it can be claimed into again.

## MP2.5c the ACCOUNT card's data rows

- Signed in, the card adds Download my data (one JSON file: the API's export and the door's) and Delete account (two taps; the door
  first, so a player still in the world keeps everything, then the API, then the page signs out).
- The door is read on the tap from the signed release file (`client/game/accountDoor.ts`), believed only when the signature holds,
  since the join ticket goes there. The game layer can't import `shared/host/releaseRows`, so it reads only `socket` itself.

## Review fixes (one-shot review of the plan/mmo4 land)

- M1: a delete drained no queued save, and a join between its ticket and its seat was not "playing": the account could come back.
  The delete now drains the account's queue first, and the door holds the seat (`World.holdForDelete`): a join in progress refuses
  the delete (409), a join during a delete dials again. Mutants of both guards go red.
- M2: a door that could not be read left the buttons stuck; the card now says try again.
- S1/S4/S6: an export whose door failed gives no file; a delete whose API half failed says the saves are gone and to tap again; the
  failure log carries the error's class, never a database message that can quote the account.
- Still open, written in MMO-PLAN MP2.5: chat reports keep the account id; the hour-long join ticket alone can delete; guest expiry
  deletes receipts where account delete keeps them anonymously.
- Review 2: a deleted account's live ticket (an hour) seated it again after the delete; the door now seats such a ticket as the
  device's guest for two hours. A delete also waits for a Name claim still running in the database, a bare 404 from a door without
  the routes is not "nothing saved", and a drain timeout logs as `save-pending`. The hold is per door process: one door per saves
  database is assumed (MP2.5's row says so).
