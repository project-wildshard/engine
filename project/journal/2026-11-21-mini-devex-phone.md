# MINI-DEVEX MD1 to MD3: the phone queue, split locks, a served world that stays up

> Written by: Claude (mini-devex-phone)

- MD2: `scripts/memory/iphone/locks.mjs` names the measurement locks. iphone13.lock is the phone only; desktop WebKit,
  the fps table and the Metal staircase take desktop-gpu.lock (then the legacy mini-measure.lock, so a checkout from
  before the split never measures beside a new one). A desktop census no longer queues behind a phone route.
