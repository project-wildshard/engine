// The admission revision a client build stamps. An installed engine has no lockfile to hash, so authors read this file, and
// a tag has to carry the revision of its own package.json: gen writes it for a tree, and `release:stamp` after a version bump.
import { writeFileSync } from 'node:fs';
import { shardfileValidationRevision } from './shardfile-validation-revision.mjs';

writeFileSync(new URL('validation-revision.json', import.meta.url), `${JSON.stringify({ revision: shardfileValidationRevision() })}\n`);
