import {writeFileSync} from 'node:fs';
import {rendererRevision} from './renderer-revision.mjs';
writeFileSync(new URL('./renderer-revision.json',import.meta.url),`${JSON.stringify({revision:rendererRevision()})}\n`);
