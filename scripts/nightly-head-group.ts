// Select only an actual committed pin, in the production nightly partition.
import {headGroups, plan} from './nightly-model.ts';

const [slug, browser = 'chromium'] = process.argv.slice(2);
if (browser !== 'chromium' && browser !== 'webkit') throw new Error('Choose chromium or webkit');
const group = headGroups(plan().heads, browser).findIndex(heads => heads.some(head => head.slug === slug));
if (group === -1) throw new Error(`No committed nightly head: ${slug ?? '(missing)'}`);
console.log(group);
