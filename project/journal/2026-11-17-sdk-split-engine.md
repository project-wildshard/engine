# SDK-SPLIT in the engine (SP5)

> Written by: Claude (opus-sdksplit3)

- SP5a: vite 8.3.0 -> 8.3.8 (peer and dev pin), hono 4.13.13 -> 4.13.19
  and @hono/node-server 2.1.5 -> 2.1.8: the fixed releases for the npm
  audit findings a fresh `@wildshard/sdk` install reported through the
  engine's exact pins (meta SDK-SPLIT SP-NE3 follow-up). Lockfile only
  otherwise; lint, typecheck and the hono-serving tests pass.
