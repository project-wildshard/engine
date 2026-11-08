// EG-21: compare actual same-commit play witnesses, independently of platform baselines.
import {readFileSync} from 'node:fs';
const [first,second]=process.argv.slice(2);
if(first===undefined||second===undefined)throw new Error('usage: compare-platform-steps <first.json> <second.json>');
const a=JSON.parse(readFileSync(first,'utf8')),b=JSON.parse(readFileSync(second,'utf8'));
if(a.sha!==b.sha||a.ticks!==b.ticks)throw new Error('Platform witnesses must name the same commit and tick count');
if(a.platform===b.platform)throw new Error('Two witnesses from one platform are not a cross-platform comparison');
const slugs=new Set([...Object.keys(a.measured),...Object.keys(b.measured)]);
for(const slug of slugs){
  const x=a.measured[slug],y=b.measured[slug];
  if(x===undefined||y===undefined)throw new Error(`Missing actual witness for ${slug}`);
  console.log(`${slug}: ${JSON.stringify(x)===JSON.stringify(y)?'SAME':'DIFFERS'} (${a.platform}, ${b.platform}; ${a.ticks} ticks)`);
}
console.log(`Compared ${slugs.size} actual products at ${a.sha}; report only, no baseline changed`);
