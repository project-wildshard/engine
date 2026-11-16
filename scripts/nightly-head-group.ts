// Select only an actual committed pin, in the production nightly partition.
import {groups, partition, plan} from './nightly-model.ts';

const slug = process.argv[2];
const heads = plan().heads;
const group = Array.from({length: groups}, (_, index) => index)
  .find(index => partition(heads, index).some(head => head.slug === slug));
if (group === undefined) throw new Error(`No committed nightly head: ${slug ?? '(missing)'}`);
console.log(group);
