# 2026-11-12 Nalati's sneak shot runs on the server (SS4, opus-ss4)

- Why: the page doubled a bow shot loosed from Hidden for 4 s (`stealth.entry` binds the
  bow's hit multiplier to `StealthCrouch.sneakMultiplier`), but the room server's arms
  launched every arrow and javelin at ×1. Prey the page showed dying lived online
  (meta SERVER-PARITY row SS4, HOSTS rows `stealth.entry` and `player/stealth`).
- Change: `src/server/game/stealth/nativeStealth.ts` reads the page's own rows (client
  plan `stealth.entry`, `player/stealth`) and gives each room player a `StealthCrouch`
  seat, stepped from that player's crouch, sprint, jump, grass, herds, packs and mount.
  The arms note every fire (blade start, bow loose, polearm start, javelin launch) as the
  page's `weapon.fired` does, and scale arrows (`onHitScale`) and javelins (`damageScale`)
  by the seat's multiplier at the hit. Rooms only: tapes keep ×1 and their bytes. The HUD,
  disc and hint stay the page's. No shard bytes change: no re-upload.
- Red first: `test/net-sneak-shot.test.ts` failed on main (the Hidden arrow dealt 43, as
  the standing one did); now it deals ×2, the window shuts after 4 s, and a later
  standing arrow is plain.
- Left: the seat is installed after the arms, so `exportSeats` keeps its indexes; a shot
  reads Hidden one tick old where the page reads the same frame. The crouch disc's latch
  isn't a room command; a latched page sends `crouch`, which the server sees.
