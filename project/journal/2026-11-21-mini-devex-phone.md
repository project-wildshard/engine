# MINI-DEVEX MD1 to MD3: the phone queue, split locks, a served world that stays up

> Written by: Claude (mini-devex-phone)

- MD2: `scripts/memory/iphone/locks.mjs` names the measurement locks. iphone13.lock is the phone only; desktop WebKit,
  the fps table and the Metal staircase take desktop-gpu.lock (then the legacy mini-measure.lock, so a checkout from
  before the split never measures beside a new one). A desktop census no longer queues behind a phone route.
- MD3: `serve-local.mjs --public --keep` hands the build's world to launchd (`serve-keep.mjs`, label
  io.wildshard.serve.<sha12>, state in ~/.cache/wildshard/kept/). The keeper owns two quick tunnels and the dev world in
  their own process groups: a killed world restarts on the same port behind the same tunnels (16 s, reusing its built
  client), a killed keeper is restarted by launchd in about a second and adopts them by pid. The exit 144 killer was
  meta's SubagentStop hook (meta 2e02b5c1), which now spares kept pids.
- MD1: the phone queue. `phone-queue.mjs` (a queue directory beside the locks) and `phone-runner.mjs` (kept by launchd
  as io.wildshard.phone-runner, holding runner.lock): lanes submit, the runner cools outside the lock, holds iphone13.lock,
  parks Safari, retries a voided run once after the origin answers, writes the result and a receipt. route-bench,
  link-bench and bench.mjs submit for you; other scripts use `phone-queue.mjs submit -- <script>`. Order: DRIFTWOOD-FPS,
  frame-rate walks, zone boots, then other; first come first served within each.
