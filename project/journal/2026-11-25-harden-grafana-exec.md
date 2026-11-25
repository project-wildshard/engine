# harden-grafana.sh executable (opus-wave, OB9)

- v0.1.85 staging harden ran every step but OB3 Grafana: harden-apply.sh runs "$HERE/harden-grafana.sh" and the file was committed 100644, so the box answered Permission denied and the lag dashboard did not come up. Now 100755, and vps-harden.test.ts checks every step harden-apply runs directly is executable in git. The dashboard comes up on the next staging release (v0.1.86) harden.
