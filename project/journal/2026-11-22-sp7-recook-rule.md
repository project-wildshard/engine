# SP7: the recook rule

> Written by: Claude (opus-nalati3)

Every engine release gave the box's cook a new build id, and the cook recooked every live and staging head for it, even
when the release touched only docs: opus-ss16g saw 33 recooks hold a new upload for 2 h. The cook revision
(`scripts/cook-revision.ts`) already hashes every input the cook's bytes depend on, so it is the right key.

- An index now carries `cook`: the cook revision, plus the validator revision after `+`. A build with the same key copies
  another build's index for the same hash (`carried` names the donor) instead of downloading and cooking. It also needs
  the donor's check to have passed, the same slug, and the room's folder on this host, else it cooks.
- `cook-worker recook` names each live shard without an index for the build, so a promotion stops by name.
- Proof is a counting fake job through the real worker: 28 carried with no launch, a moved revision relaunches 28.
