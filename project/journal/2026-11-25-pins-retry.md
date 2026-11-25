# Pins install rides out one bad fetch (opus-kit2, meta QA 11-25 row 39)

- Engine CI's tests (5) went red on one 503 from raw.githubusercontent.com for a pinned Nalati asset, the second infra
  red in pins install after 11-24's mirror 404. A pinned public asset now gets 3 tries over about 25 s on no response or
  a 5xx, and a 404 moves at once to GitHub's contents API at the same pinned commit; hashes stay the authority.
- A shardfile tarball's mirror fetch retries a 5xx the same way (it went straight to the API before), a mirror 404
  still falls back to the API, and the API's waits grew from 1 s and 3 s to 5 s and 20 s (`WILDSHARD_PIN_RETRY_MS`).
- A final failure names every URL it tried and what each answered, so the next red says which host blipped.
