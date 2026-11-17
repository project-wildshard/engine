# Audit the cook release state as root-only

> Written by: Codex
> State: local release-path correction, 2026-11-16.

SP22 helper readiness ran the installed harden check read-only. Its only
failure was VH12 expecting cook-release.env to belong to a game-service
group. cook-follow intentionally writes that release-follow state with
mode 600; root/systemd reads it, as for cook.env and ops.env.

Teach the audit that exact file name the existing root-only policy. Do
not broaden the policy for service env files or accept a group-readable
cook release state. Three actual script controls fail first against the
old audit, then exercise exact root-only success, broader mode refusal
and wrong-group refusal. The fixture also asserts its tree is unchanged.

No live permissions, SSH, firewall, Tailscale, helper or credentials were
changed. Source qualification does not claim the signed helper refresh
or staging async shipment; those remain SDK-SPLIT SP22.
