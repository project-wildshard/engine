// Select only an actual committed pin, in the production nightly partition.
import {headGroups, headRunner, plan} from './nightly-model.ts';

const [slug, browser = 'chromium'] = process.argv.slice(2);
if (browser !== 'chromium' && browser !== 'webkit') throw new Error('Choose chromium or webkit');
const groups = headGroups(plan().heads, browser);
const group = groups.findIndex(heads => heads.some(head => head.slug === slug));
const members = groups[group];
if (members === undefined) throw new Error(`No committed nightly head: ${slug ?? '(missing)'}`);
console.log(JSON.stringify({group, os: headRunner(browser, members)}));
