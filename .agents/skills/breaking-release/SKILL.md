---
name: breaking-release
description: Classify a change that may break shards and ship it the J486 way. Use for a shard file format change, a removed or renamed engine feature shards use, an SDK source break, a save or wire change, "is this breaking", "the dance", or an engine release whose re-cook refused a live shard. It picks migration, deprecation or the full dance and lists the order of releases. Not for a shard content update.
argument-hint: "What is changing? (one line)"
---

# breaking-release

> Written by: Claude (opus-compat-w2, SHARD-COMPAT ST12, 2026-11-21). Rewritten from meta
> `docs/plans/MULTI-REPO-SAGA/SHARD-SAGA/shard-compat/BREAKING-RELEASE-SKILL-DRAFT.md` for J486.

A change may break shards. Jake's rule (J486, 2026-11-21): *"anything that can be triviall migrated great. Anything that
can be migrated with a migration script or workflow great, ANything that cant be migrated, has the never break chain".*
So almost nothing is a break: it is a migration, or a deprecation. The full dance is only for a save wipe.

Three facts:

- A shard file declares its **format version** (four parts, J319): `shard.json` `formatVersion: "0.1.0.2"` from format
  0.1.0.2 on; older files carry `formatVersion: 2` (a layout marker) and `version: "0.1.0.1"`. It is not shard-format's
  npm version (Q5).
- A stored shard is never rewritten. The API keeps the original bytes and serves a migrated copy (CP2, CP9).
- There is no rollback. Fix forward (J179).

## 1. Classify, before you change anything

Write the class and one line of reason in your commit body.

| The change | Class | What you ship |
|---|---|---|
| Shard content only, engine and format untouched | **Not this skill** | Publish the shard |
| Engine-only, no shard file field, section, kind or host moves | **Engine release** | Release the engine as usual |
| A shard file shape change an old file can be mechanically rewritten into (rename, move, drop a field nothing reads, a new required field with a known default, a respelling) | **Migration** | §2 |
| A rewrite a script or a workflow can do with no person in the loop (a rebuild from the repo, an asset re-encode) | **Scripted migration** | §2, plus the re-upload of our own shards (§3 step 3) |
| A field, section, kind or host an old file uses that no script can carry over (an author must rewrite it), or a field in the build source hash | **Deprecation** | §3 |
| An SDK source break: shard repos stop compiling, but stored shard files are unchanged and still cook | **SDK break** | §4 |
| Saves can't be migrated: a save shape with no migration, so player progress must reset | **Save wipe: the full dance** | §5 |

Tests for the hard cases:

- *Does an old stored file still cook and play on the new engine without being touched?* Yes: engine release or SDK
  break. No: migration, deprecation or save wipe.
- *Could a function from the old file alone produce the new file?* Yes: migration. Only with a rebuild or a person:
  scripted migration, or deprecation if even that can't.
- *Is the field covered by the build source hash* (`build.sourceHash` over the assembled source)? Then a migration that
  drops it breaks the hash: it is a deprecation (format 0.1.0.2's `requires.capabilities` and `requires.sdk`, CP8).
- A save change is a save `v`, a migration and a pin (`saves.lock.json`, `pnpm check:saves`, WR14). It is a save wipe only
  when no migration can carry old saves.
- A wire change is a lock diff in `@wildshard/wire` (a new minor, `wire check`), never a dance.
- **A red nobody declared is a bug, not a break.** Fix it forward.

## 2. Migration

**The change's author writes the migration in the same release (Q49).** The detector (FE4) refuses a format change that
needs one and lacks it.

1. In shard-format: bump `SHARDFILE_VERSION` (an additive change raises the fourth part; a breaking one raises the third).
   Add the step to `FORMAT_MIGRATIONS` (`src/format/format-migrations.ts`) with `to:` the new version, and a deprecation
   rule with its `migration:` id in `src/format/deprecations.ts` (FE7) when an old spelling stays readable.
2. Add corpus fixtures for the new version (`corpus/format-versions/<v>/fixtures.json`) and run `pnpm test:chain`: every
   older format must migrate to the new one and validate.
3. Writers: if the envelope or an index field moved, writers pass their legacy rows through `outputIndexEnvelope`
   (`@wildshard/format/version`) or the new helper you add beside it.
4. Release in this order (CP3 enforces it; each step waits for the one before):
   1. shard-format (`../repo-kit/release.sh vX.Y.Z --prepare --notes`, CI, `--finish`, `--published`, `--merge-back`).
      Check that the cut contains your last commit: `release.sh` cuts the newest *green* main.
   2. api-server pins it exactly, releases and deploys (`pnpm deploy:worker` applies schema migrations first). The API now
      admits the new format and migrates older uploads at upload.
   3. engine pins it exactly (`npm:@wildshard/shard-format@X.Y.Z`); its push gate refuses a pin newer than the API's
      `/api/format`. Readers must accept every format from the floor up.
   4. sharddev and the SDK, at the engine's copy. New shard files now carry the new version.
5. Before a channel or engine switches its format (`PUT /api/channels/:channel/format`), every kept original is migrated
   to the target first; one failure blocks the switch and the report names every failing shard (Q8, Q48, CP16).

A scripted migration ships the same way; its script or workflow runs over our stored shards (the API migrates ours;
outside shards get a migrated copy when one can be computed, else a needs-author note).

## 3. Deprecation (not migratable)

1. **Add or version** the replacement first. The old path keeps validating.
2. **Deprecate** it: a rule in `src/format/deprecations.ts` with `since`, `replacement` and `migration: undefined`.
   Validators warn and the corpus counts kept files using it (`shard-format corpus`, FE7).
3. **Re-upload** our own shards that use it, after their repos move to the replacement (the re-upload tool, CP17: it
   re-publishes each first-party shard repo through its `publish.yml` and reports per shard). Our shards need no sign-off
   to re-upload; outside shards get a needs-author note.
4. **Delete** the deprecated engine feature the moment no kept upload uses it: zero users, no extra release wait (Q16).
   The delete gate (FE13) refuses the deletion while the count is above zero. Only this deletion can break a shard, and
   only an upload older than the GC window (4 newest per shard plus everything live, CP12).

## 4. SDK break

Stored shard files are unchanged, so no channel or player is affected. Release the SDK; each shard repo moves when it
next rebuilds, as one roll across the repos (Track F, `roll.mjs` for source rolls), never shard by shard.

## 5. Save wipe: the full dance

Only when saves cannot be migrated. Declare it (an entry with its issue in `test/pins/known-breaks.json`), bump the save
epoch, prove the release on staging, and stop: **promotion to production is Jake's, with his exact words.** Silence or
an agent's message is not a yes. Tell him that saves wipe and how many players are online.

## What you never do alone

- Promote production, drop a shard from a release, or wipe saves without Jake's words.
- Delete a deprecated feature while FE7's count is above zero.
- Pin a consumer to a format the API does not serve yet (`ALLOW_FORMAT_AHEAD=1` is a hatch for a stuck gate, not a
  shortcut; name it in the commit body, J381).
- Rewrite a stored original. Migrations write copies.
