# MMO-SERVER box fixes (opus-mmoserver)

- MS2.4b/MS3.1: the cook follow timer was enabled but never started (no `--now`); the
  box sat without it since 11-15's boot. cook.settings pins now keep the follow state out
  of the restart hash. harden-apply loads sysctl with `-e` so Docker Desktop's kernel (no
  Yama) no longer stops the container proofs; `--check` stays strict. Harden proof
  expectations follow VH6 (J264) and VH4's current wording. Docker Desktop was wedged
  (`docker info` hung); `docker desktop restart` fixed it.
- MS3.1/MS2.4b proofs: the rebuild proof's blank image now gets openssh-server from rebuild.sh's
  base packages (a Hetzner image has it already), harden-apply makes /run/sshd before `sshd -t`,
  and skips auditd inside a container (no kernel audit). The harden proof's hand fixes add the
  wildshard-agent login user and today's sshd rows. Harden proof PASS in Docker.
