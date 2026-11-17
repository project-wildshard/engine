# MMO sign-in polish (MMO-PLAN MP2.2g, opus-mmo4)

- **The link leaves the address at boot.** A mailed `#login=wsl_…` used to sit in the address until the title built, and the
  boot-timing collector posts `location.href` to the service worker meanwhile (a stale-build reload keeps it too). index.html's
  `data-login-door` script now moves the token into session storage before anything else reads the address; `takeLink` spends it
  from there (the hash is still read, for a cached document from before the door).
- **"Signed in as" once.** A spent link's note repeated the card's own who line; the note is empty on success now.
