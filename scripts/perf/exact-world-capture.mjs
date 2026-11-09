// Run through browser-lane.sh against an immutable serve-build.sh --rev preview.
import { chromium, devices } from 'playwright';
import * as v from 'valibot';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installInit } from '../parity/init.mjs';
import { poseAt, advance } from '../parity/frames.mjs';
import { fixedWorldFrame } from '../parity/fixed-render.mjs';
import { readParityFrame } from '../parity/frame-bytes.mjs';
import { developerSettings, saveFixture } from '../debug-settings.mjs';
import { loadingCardIndex } from '../loading-benchmark/catalogue.mjs';
import { loanMaterialPrograms, trackMaterialProgramDraws } from './material-program-loan.mjs';
import { worldPixelDifference } from './world-pixel-difference.mjs';
import { KEYCHAIN_ARGS } from '../chromium-keychain.mjs';

/** @param {string} name */
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const url = arg('url'), candidate = arg('candidate'), mode = arg('mode') ?? 'shardfile';
const loanPath = arg('material-program-loan');
const sourceSchema = v.strictObject({vertex:v.string(),fragment:v.string(),vertexHash:v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u)),fragmentHash:v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u))});
const materialPrograms = loanPath === undefined ? null : v.parse(v.pipe(v.array(v.strictObject({aliases:v.pipe(v.array(v.pipe(v.string(),v.minLength(1))),v.minLength(1)),before:sourceSchema,after:sourceSchema,uniforms:v.array(v.string())})),v.minLength(1)),JSON.parse(readFileSync(loanPath,'utf8')));
if (materialPrograms !== null && (candidate !== undefined || arg('slug') === undefined)) throw new Error('Program loan requires one explicit slug and no immutable candidate');
const hasCandidate = candidate !== undefined || materialPrograms !== null;
const held = arg('include-viewmodel');
if (held !== undefined && held !== '1' && held !== '0') throw new Error('Requires --include-viewmodel=0|1');
const includeViewmodel = held === '1';
const approvedFlakes=arg('g941-nine-flakes');
if(approvedFlakes!==undefined&&approvedFlakes!=='1')throw new Error('Requires explicit --g941-nine-flakes=1');
const g941=approvedFlakes==='1';
if(g941&&(arg('slug')!=='nine-dragon-stack'||includeViewmodel))throw new Error('G941 applies only to the explicit Nine world-only cohort');
if (mode !== 'shardfile') throw new Error(`--mode=${mode}: the LEGACY entry is gone (QD7 LD5); only shardfile captures`);
if (!url) throw new Error('Requires --url=URL [--candidate=URL --slug=SLUG --pose=P1 --out=tmp/...]');
/** @type {typeof readParityFrame<ReturnType<typeof fixedWorldFrame>>} */
const readWorldFrame = readParityFrame;
const out = resolve(arg('out') ?? 'tmp/exact-world-capture');
const D = Math.PI / 180;
const sets = [
  { slug: 'nine-dragon-stack', poses: [
    { name: 'P1', x: .95, y: 125, z: 7.5, yaw: -12*D, pitch: -4*D },
    { name: 'P2', x: .95, y: 125, z: 7.5, yaw: -12*D, pitch: 35*D },
    { name: 'P3', x: -10, y: 107, z: -25.4, yaw: -90*D, pitch: 30*D },
    { name: 'P4', x: 76, y: 146, z: 6, yaw: 90*D, pitch: -10*D },
    { name: 'P5', x: 76, y: 146, z: 6, yaw: -90*D, pitch: 4*D },
  ] },
  { slug: 'pine-hollow', poses: [
    { name: 'P1', x: 0, z: -235, yaw: Math.PI, pitch: 0 },
    { name: 'P2', x: 0, z: -200, yaw: Math.PI, pitch: 0 },
    { name: 'P3', x: 0, z: -28, yaw: Math.PI, pitch: 0 },
    { name: 'P4', x: 0, z: -28, yaw: Math.PI/2, pitch: -4*D },
  ] },
  { slug: 'driftwood-isle', poses: [{ name: 'P1', x: 100, z: 1, yaw: -Math.PI/2, pitch: -.05 }] },
].filter(set => !arg('slug') || arg('slug') === set.slug).map(set => ({ slug: set.slug, poses: set.poses.filter(pose => !arg('pose') || arg('pose') === pose.name) }));
if (!sets.some(set => set.poses.length)) throw new Error('No requested capture pose');
mkdirSync(out, { recursive: true });
const version = v.parse(v.object({build:v.string()}), await (await fetch(new URL('version.json', url))).json());
const candidateBuild = candidate === undefined ? null : v.parse(v.object({build:v.string()}), await (await fetch(new URL('version.json', candidate))).json()).build;
/** @type {(Omit<ReturnType<typeof fixedWorldFrame>,'data'> & {repeat:number,slug:string,pose:string,pixels:string,file:string})[]} */
const rows = [];
/** @type {{kind:'AA'|'AB',slug:string,pose:string,pixels:number,approvedPixels:number,unapprovedPixels:number,first:import('./world-pixel-difference.mjs').WorldPixelDifference['first']}[]} */
const differences = [];
/** @type {{repeat:number,url:string,build:string}[]} */
const builds = [];
const protocol = includeViewmodel
  ? 'M3 world/native posed camera; no post; viewmodel included/actual draws required; Metal iPhone 16 Pro DPR2; fixed uniform time10; fresh-context seeded A/A; GL_DITHER off; serial GPU draw completion; full RGBA exact'
  : 'M3 world/native posed camera; no post/viewmodel; Metal iPhone 16 Pro DPR2; fixed uniform time10; fresh-context seeded A/A; GL_DITHER off; serial GPU draw completion; full RGBA exact';
/** @type {{slug:string,pose:string,receipts:import('./material-program-loan.mjs').ProgramLoanReceipt[],draws?:Record<string,number>}[]} */
const loanReceipts=[];
/** @type {{slug:string,pose:string,pixels:number,approvedPixels:number,unapprovedPixels:number,first:import('./world-pixel-difference.mjs').WorldPixelDifference['first']}[]} */
const loanRestoration=[];
const result = { mode, builds, protocol, approvedFlakes:g941?'G941 exact two coordinate/RGBA pairs; raw differences retained':null, build: version.build, candidate: candidate ?? null, rows, differences,
  candidateBuild, ...(materialPrograms === null ? {} : {programLoan:{source:loanPath,kind:'injected compiled-program proof, not immutable product A/B',receipts:loanReceipts,restoration:loanRestoration}}) };
const save = () => writeFileSync(join(out, 'reading.json'), JSON.stringify(result, null, 2));
const device = devices['iPhone 16 Pro'];
if (device === undefined) throw new Error('Missing maintained phone preset');
/** @template T @param {string} phase @param {()=>Promise<T>} run @returns {Promise<T>} */
async function bounded(phase, run) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  try {
    return await Promise.race([run(), new Promise((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error(`Fixed world capture stalled: ${phase}`)); }, 30000);
    })]);
  } finally { clearTimeout(timer); }
}
const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  for (const [repeat, sourceUrl] of [url,url,...(hasCandidate ? [candidate ?? url] : [])].entries()) for (const {slug, poses} of sets) {
    if (poses.length === 0) continue;
    const sourceVersion = v.parse(v.object({build:v.string()}), await (await fetch(new URL('version.json', sourceUrl))).json());
    if (sourceVersion.build !== (repeat === 2 ? candidateBuild ?? version.build : version.build)) throw new Error('Capture source build changed');
    builds.push({repeat,url:sourceUrl,build:sourceVersion.build});
    const context = await browser.newContext({ ...device, viewport: {width:402,height:874}, deviceScaleFactor: 2 });
    try {
      await installInit(context, { lane: 'exact-world-capture', sha: sourceVersion.build, browser: 'chromium', capture: 30, tier: 'phone' });
      await developerSettings(context, { tier: 'phone', volume: 0, time: 'midday' });
      await saveFixture(context, {scope:'global',key:'gfx',data:{dpr:'2',aa:'auto'}});
      /** @type {string[]} */
      const errors = [];
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      console.log(`${repeat} ${slug} entry`);
      await page.goto(sourceUrl, {waitUntil:'load'}); await page.locator('.ws-main-select').click();
      const names = await page.locator('.ws-menu-card b').allTextContents();
      await page.locator(`.ws-menu-dots i[data-i="${loadingCardIndex(names, slug)}"]`).click();
      const enter = page.locator('.ws-menu-play');
      if (await enter.isDisabled()) throw new Error(`ENTER WORLD disabled for ${slug}`);
      await enter.click();
      await page.waitForFunction(() => window.__wildshard?.world?.hud?.entered && !document.querySelector('.ws-load'), undefined, {timeout:240000});
      if (!(await page.evaluate(() => window.__wildshard.requireWorld().game.level.id)).includes(slug)) throw new Error('Wrong captured world');
      for (const pose of poses) {
        await bounded(`${slug}/${pose.name}/pose`, async () => { await poseAt(page, pose); await advance(page, 90); });
        if (repeat === 2 && materialPrograms !== null) {
          const receipts = await page.evaluate(`(async()=>{const g=window.__wildshard.requireWorld().game,materials=new Set();g.rootScene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.isShaderMaterial)materials.add(m);});const loan=await (${loanMaterialPrograms.toString()})([...materials],${JSON.stringify(materialPrograms)});try{const track=(${trackMaterialProgramDraws.toString()})(g.renderer,loan.receipts),restore=loan.restore;loan.draws=track.read;loan.restore=()=>{try{track.restore();}finally{restore();}};window.__exactWorldProgramLoan=loan;return loan.receipts;}catch(error){loan.restore();throw error;}})()`);
          result.programLoan?.receipts.push({slug,pose:pose.name,receipts});
        }
        const file = join(out, `${repeat}-${slug}-${pose.name}.rgba`);
        const frame = await bounded(`${slug}/${pose.name}/readback`, async () => readWorldFrame(page, await page.evaluateHandle(fixedWorldFrame, {...pose,includeViewmodel}), file));
        const bytes = readFileSync(file);
        let lit = 0; for (let at = 0; at < bytes.length; at += 4) if (bytes[at] + bytes[at+1] + bytes[at+2] > 0) lit++;
        if (lit === 0) throw new Error('Empty world image');
        const pixels = createHash('sha256').update(bytes).digest('hex');
        result.rows.push({repeat,slug,pose:pose.name,...frame,pixels,file}); save();
        console.log(`${repeat} ${slug}/${pose.name} ${frame.calls} draws ${frame.triangles} tris frame${frame.frame} ${pixels.slice(0,12)}`);
        if (repeat === 2 && materialPrograms !== null) {
          const draws=v.parse(v.record(v.string(),v.pipe(v.number(),v.integer(),v.minValue(0))),await page.evaluate('window.__exactWorldProgramLoan.draws()'));
          const receipt=loanReceipts.find(row=>row.slug===slug&&row.pose===pose.name);
          if(receipt===undefined)throw new Error('Program draw receipt is absent');receipt.draws=draws;
          await page.evaluate('window.__exactWorldProgramLoan.restore();delete window.__exactWorldProgramLoan;');
          const restoredFile=join(out,`restored-${slug}-${pose.name}.rgba`);
          await readWorldFrame(page,await page.evaluateHandle(fixedWorldFrame,{...pose,includeViewmodel}),restoredFile);
          const original=result.rows.find(row=>row.repeat===0&&row.slug===slug&&row.pose===pose.name);
          if (original===undefined) throw new Error('Program restoration has no original image');
          const restored=readFileSync(restoredFile),before=readFileSync(original.file);
          if(restored.length!==before.length)throw new Error('Program restoration dimensions differ');
          const difference=worldPixelDifference(before,restored,frame.width,frame.height,pose.name,g941);
          result.programLoan?.restoration.push({slug,pose:pose.name,...difference});save();
          if(difference.unapprovedPixels!==0)throw new Error('Program loan did not restore exact native pixels');
        }
      }
      errors.push(...await page.evaluate(() => window.__wildshardHarness?.errors ?? []));
      if (errors.length > 0) throw new Error(`Native page errors: ${JSON.stringify(errors)}`);
    } finally {
      try {
        const activePage=context.pages()[0];
        if(materialPrograms!==null&&activePage!==undefined&&!activePage.isClosed())await activePage.evaluate('window.__exactWorldProgramLoan?.restore();delete window.__exactWorldProgramLoan;');
      }finally{await context.close();}
    }
  }
  for (const row of result.rows.filter(item => item.repeat === 0)) {
    for (const repeat of hasCandidate ? [1,2] : [1]) {
    const next = result.rows.find(other => other.repeat === repeat && other.slug === row.slug && other.pose === row.pose);
    if (!next) throw new Error('Missing independent A/A capture');
    const a = readFileSync(row.file), b = readFileSync(next.file);
    if (a.length !== b.length) throw new Error('Readback dimensions changed');
    const difference=worldPixelDifference(a,b,row.width,row.height,row.pose,g941);
    result.differences.push({kind:repeat===1?'AA':'AB',slug:row.slug,pose:row.pose,...difference});
    }
  }
  save();
  if(materialPrograms!==null)for(const program of materialPrograms)for(const alias of program.aliases){
    if(!loanReceipts.some(row=>(row.draws?.[alias]??0)>0))throw new Error(`Program loan has no actual native submission: ${alias}`);
  }
  const failed = result.differences.filter(row => row.unapprovedPixels !== 0);
  for (const row of failed) console.error(`${row.kind} ${row.slug}/${row.pose}: ${row.pixels} differing RGBA pixels`);
  if (failed.length > 0) throw new Error('World AA/AB pixel mismatch; inspect reading.json');
} finally { await browser.close(); }
