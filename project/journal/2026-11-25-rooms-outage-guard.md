# Both rooms hosts 521 for an hour; the release now reads them (opus-rel86, FAST-RELEASE FR-A15)

- At 10:11 UTC Caddy, the one proxy in front of both channels' rooms, rolled its 50 MiB access log. lumberjack's roll and
  the gzip after it chown the new file, and harden's `SystemCallFilter=~@privileged` holds @chown, so the kernel killed
  Caddy (SIGSYS); each restart died again 2 s in on the gzip. `3cce867c4` lets Caddy chown.
- v0.1.88's staging checks passed through that hour because every release gate reads the tailnet. A staging or
  production release now reads both public /up URLs before the check, after the cook and harden, and after the alias,
  and stops on anything but 200; ALLOW_ROOMS_DOWN=1 is the escape for a release that fixes an outage (J381).
- test/vps-harden.test.ts renders each drop-in harden-apply.sh writes (server, cook, Caddy), applies its SystemCallFilter
  lines in systemd's order, and holds every syscall group the service is known to call allowed (CALLS; Caddy's @chown for
  the log roll). A new call goes into CALLS, so the filter changes before a box kills the service.
- scripts/rooms-watch.mjs is the outside alarm that reaches an agent: Sentry's uptime monitor did raise WILDSHARD-GAME-86 at
  10:13, but its rules only mail Jake and no agent polls Sentry. Every 60 s (a LaunchAgent, `--install`) it reads both
  rooms /up URLs and, with a Sentry token, the open outage issues; two failed reads or a new outage issue give one
  `NOTE RED builder:` receipt and an hc send to the builder. The disabled Sentry monitors stay off (one free seat).
