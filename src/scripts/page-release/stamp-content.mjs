#!/usr/bin/env node
// PAGE-SIZE PZ6 (meta docs/plans/PAGE-SIZE-PLAN.md, J276): a split page (`dist/`, its content in `dist-content/`) reads its
// content from the CDN. The content set is named by the files content.mjs publishes from `dist-content/`, so the base is
// known before the upload: stamp it into `dist/index.html`, then bake the service worker again from the stamped document
// (content-sw-proof's order; the worker's precache lists move to CDN URLs). page-release.mjs runs this in the build phase
// when it publishes content, and its upload phase refuses a published set whose base differs from the stamped one.
//
//   node --import ./src/scripts/bake-loader.mjs src/scripts/page-release/stamp-content.mjs <dist>
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {stampContentBase} from '../app-build/contentBase.mjs';
import {contentGaps} from '../app-build/splitOutput.mjs';
import {contentBaseOf, contentSet, scanContent} from './content.mjs';

const dist = process.argv[2];
if (dist === undefined) throw new Error('usage: node --import ./src/scripts/bake-loader.mjs src/scripts/page-release/stamp-content.mjs <dist>');
const page = resolve(dist), content = `${page}-content`, root = resolve(import.meta.dirname, '../../..');
if (!existsSync(content)) throw new Error(`${content} is missing: stamp a split page (pnpm build:game splits it)`);
const files = scanContent(content);
if (files.length === 0) throw new Error(`${content} holds no content`);
// QA 11-25 row 121 (P0): the stamped page reads every content path from the set, so the cut refuses a gap.
const gaps = contentGaps(page, new Set(files.map(file => file.path)));
if (gaps.length > 0) throw new Error(`${dist} holds ${gaps.length} content path(s) its set lacks, so the stamped page would 404 on them: ${gaps.slice(0, 8).join(', ')}${gaps.length > 8 ? ', ...' : ''}`);
const base = contentBaseOf(contentSet(files));
writeFileSync(join(page, 'index.html'), stampContentBase(readFileSync(join(page, 'index.html'), 'utf8'), base));
const {writeServiceWorker} = await import('../app-build/serviceWorker.ts');
await writeServiceWorker(page, root);
console.log(`stamped ${dist}/index.html with ${base} (${files.length} content files) and baked its service worker again`);
