# The box stops reporting our own SSH logins (S16, buddy-engine)

- SENTRY-TRIAGE S16. VH14's `wildshard-alert` sent a Sentry event for
  every PAM session, so each agent or operator login over the tailnet
  became `WILDSHARD-SERVER-2`/`-4` noise (ignored in Sentry since 11-13).
- The alert now returns early for an `sshd` session whose `PAM_RHOST` is
  in the tailnet's ranges (100.64.0.0/10, fd7a:115c:a1e0::/48). sudo, the
  console, SSH from any other address and fail2ban's bans (the failed
  logins, which come in as an argument) still report.
- `WILDSHARD_ALERT_PRINT` prints the line instead of sending it, so
  `test/vps-auth-alert.test.ts` runs the script exactly as harden-apply
  installs it. PAM and fail2ban never set it.
- No box was touched: it reaches the box with the next signed tag's
  harden apply (`wildshard-apply <tag> harden`).
