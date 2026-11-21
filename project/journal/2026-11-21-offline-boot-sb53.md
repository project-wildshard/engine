# SB53: offline in the loading card's first second

Lane mini-close, meta STAGING-BUGBASH SB53 (2026-11-21).

- Staging v0.1.64: 5 s offline from 200 to 700 ms after the loading card showed left it at START 0% after the network
  came back. stuck.ts reloaded once while still offline; the reloaded page's entry modules failed; RL3's retry was spent.
- A faster local build failed a lazy level.play import into the could-not-load screen instead; that stayed too.
- Fix: stuck.ts waits for 'online' before its one recovery; RL3 reloads an unbooted page on 'online' if it was offline;
  the load-failure screen shown offline reloads once online, back into the world (SB44's list gains 'offline load failure').
