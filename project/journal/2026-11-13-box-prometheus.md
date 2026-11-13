# 2026-11-13: Prometheus on the box, loopback only (SERVER-CELLS SC2)

- Jake (grill Q9, ~18:31 Cancún) on when SC2's sudo block runs: "now or you do it". So no block: `harden.sh` installs it,
  reached by `sudo -n wildshard-apply <tag> harden` like MS3.6, and the allowlist stays as it is.
- `harden-prometheus.sh`: the distro's `prometheus` and `prometheus-node-exporter` (no recommends), each pinned to
  127.0.0.1 by a drop-in written before the install, so the first start is loopback too. 15 days, no remote write, 15 s
  scrapes of production 127.0.0.1:9790, staging 127.0.0.1:9791 and the node. It stops both units if a port is wider.
- Each channel's `METRICS_PORT` goes into its `.settings` only if absent, with no restart: the next release (or an
  allowlisted restart) turns `/metrics` on. `wildshard-config` takes the channel's own port or blank, so agents can switch
  it off and back.
- Reading needs no sudo: `curl -s 127.0.0.1:9090/api/v1/targets` on the box. `harden.sh --check` fails a metrics port off
  loopback.
- Review (one claude -p, one MUST): Ubuntu's needrestart would restart a game server holding an old library after an
  apt install, so installs here (and harden's need_packages) only list. put now stops on any failure and promtool checks
  a new config before it replaces the old one; the settings step takes wildshard-config's lock.
