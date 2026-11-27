// FS28 and J475. The repo-kit still owns the release branch and page-release owns staging.
// oxlint-disable-next-line import/no-unassigned-import -- Mark the staging and production readbacks (METRICS MT16).
import './agent-fetch.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as absolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { attributionGap, cutTree, fullCommitArgs, treeDirt, writeHold, gateInputsMoved, localAttemptDir, nextAdmission, releaseCiAdmission, provesNpmNext, provesReleaseReuse, provesTrainCi, provesTrainSource, retryRead, trainSha as sha, trainTag as tagPattern, watchTrainRun,
  type Alias, type Leg, type Run } from './release-train-proof.mjs';
import { CHANNELS, localQaGap, RELEASE_PUBLIC_KEY, type QaVerdict } from './page-release/flow.mjs';
import { pidLock } from './.kit/pid-lock.mjs';
import { latestReleaseRef, releaseDueFromRefs, reminderLine } from './release-due.mjs';
import { readPublication } from './server-release/sign.mjs';
import { keepReleaseProof, openReleaseRun } from './release-run.mjs';

const repo = 'project-wildshard/engine';
const digest = /^sha256:[a-f0-9]{64}$/u;
const stage = CHANNELS.staging;
const qualification = ['qualification', 'leg.json'];
const stopping = new AbortController();
const wait = (ms: number) => delay(ms, undefined, { signal: stopping.signal });

interface Verdict {
  build: string;
  status: string;
  hold?: boolean;
  deploy?: { zoneEntry?: { build?: string; pass?: boolean; failures?: { from: string; to: string }[] } };
}
interface Asset { name: string; state: string; size: number; digest: string }
interface Version { build?: string; clientVersion?: string; preparationOnly?: boolean }
interface Room { build?: string; serial?: number }
interface RegistryMetadata { version?: string; dist?: { tarball?: string; integrity?: string } }

function command(cwd: string, file: string, args: string[], input?: string): string {
  try {
    return execFileSync(file, args, { cwd, input, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 << 20,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error(`Could not run ${file} ${args[0] ?? ''} from the release checkout`);
  }
}

function runLogged(cwd: string, log: string, file: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  stopping.signal.throwIfAborted();
  const fd = openSync(log, 'a', 0o600);
  let child: ReturnType<typeof spawn>;
  try { child = spawn(file, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] }); }
  finally { closeSync(fd); }
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      if (child.pid !== undefined) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* The process group already exited. */ }
      }
    };
    stopping.signal.addEventListener('abort', stop, { once: true });
    child.once('error', reject);
    child.once('close', code => {
      stopping.signal.removeEventListener('abort', stop);
      if (code === 0) resolve();
      else reject(new Error(`${file} did not finish. See ${log}`));
    });
  });
}

function read(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')) as unknown; }
  catch (error) {
    // page-release can be writing its evidence when the train reads it.
    if (error instanceof SyntaxError || (error instanceof Error && 'code' in error && error.code === 'ENOENT')) return undefined;
    throw error;
  }
}

function record(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function failure(task: Promise<void>): Promise<Error | undefined> {
  try { await task; return undefined; }
  catch (error) { return error instanceof Error ? error : new Error('Release step failed'); }
}

function receipt(lane: string, message: string) {
  const file = join(homedir(), '.cache/wildshard/lane-receipts.log');
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${new Date().toISOString().slice(11, 16)} UTC ${lane} ${message}\n`);
  console.log(message);
}

async function get(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Staging readback returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

async function requireSignedAlias(build: string, tag: string, serial: number) {
  const [rawPage, publication, rawHealth] = await Promise.all([get(`${stage.origin}/version.json`), get(stage.release), get(stage.health)]);
  const page = rawPage as Version | null, health = rawHealth as Room | null;
  const signed = readPublication(JSON.stringify(publication), RELEASE_PUBLIC_KEY);
  if (page?.build !== build || page.clientVersion !== tag.slice(1) || signed.channel !== 'staging' ||
      signed.engineBuild !== build || signed.serial !== serial || health?.build !== build || health.serial !== serial) {
    throw new Error('The public staging page and signed rooms must match candidate QA');
  }
}

async function sha256(path: string) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path) as AsyncIterable<Uint8Array>) hash.update(bytes);
  return `sha256:${hash.digest('hex')}`;
}

async function main(args: string[]) {
  const [tag, ...options] = args;
  const { values } = parseArgs({ args: options, options: {
    notes: { type: 'string' }, 'on-demand': { type: 'boolean' }, 'dry-run': { type: 'boolean' },
    require: { type: 'string', multiple: true },
  } });
  if (!tag || !tagPattern.test(tag) || !values.notes) {
    throw new Error('Usage: src/scripts/release.sh vX.Y.Z --notes <file> [--on-demand] [--dry-run] [--require <sha>]…');
  }
  const notes = absolute(values.notes);
  readFileSync(notes);
  const newer = (a: string, b: string) => {
    const [majorA = 0, minorA = 0, patchA = 0] = a.slice(1).split('.').map(Number);
    const [majorB = 0, minorB = 0, patchB = 0] = b.slice(1).split('.').map(Number);
    return (majorA - majorB || minorA - minorB || patchA - patchB) > 0;
  };
  const root = command(process.cwd(), 'git', ['rev-parse', '--show-toplevel']);
  const git = (cmd: string[], cwd = root) => command(cwd, 'git', cmd);
  // A `list` or `view` read retries a passing hiccup (retryRead); an upload or a workflow run happens once.
  // A `--commit` is a full SHA (fullCommitArgs): gh matches no run on a short one.
  const gh = (cmd: string[], input?: string) => input === undefined && ['list', 'view'].includes(fullCommitArgs(cmd)[1] ?? '')
    ? retryRead(() => command(root, 'gh', cmd)) : command(root, 'gh', cmd, input);
  const runView = (id: number) => JSON.parse(gh(['run', 'view', String(id), '-R', repo,
    '--json', 'databaseId,headSha,status,conclusion,jobs,workflowName,event,headBranch,displayTitle'])) as Run;
  const watchRun = (id: number, log: string) => watchTrainRun(id,
    () => runLogged(root, log, 'gh', ['run', 'watch', String(id), '-R', repo, '--exit-status', '--interval', '20']),
    runId => {
      stopping.signal.throwIfAborted();
      return runView(runId);
    });
  const ancestor = (base: string, head: string) => {
    try { git(['merge-base', '--is-ancestor', base, head]); return true; } catch { return false; }
  };
  if (!/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)project-wildshard\/engine(?:\.git)?$/u.test(git(['remote', 'get-url', 'origin'])) ||
      git(['branch', '--show-current']) !== 'main' || git(['rev-parse', '--path-format=absolute', '--git-common-dir']) !== join(root, '.git')) {
    throw new Error('Run the train from the canonical engine main checkout');
  }
  const { WS_LANE_NAME: lane = 'codex-ms' } = process.env;
  const kit = join(root, '..', 'repo-kit', 'release.sh');
  const branch = `release/${tag}`, branchRef = `refs/remotes/origin/${branch}`;
  const tree = join(root, '.worktrees', `release-${tag}`);
  const mainRef = 'refs/remotes/origin/main';
  git(['fetch', '--quiet', '--prune', '--tags', 'origin']);
  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/tags', 'refs/remotes/origin/release']).split('\n');
  const last = latestReleaseRef(refs.filter(ref => ref.startsWith('refs/tags/')));
  if (!last || !ancestor(last, mainRef)) throw new Error('Merge the last release tag into main first');
  const lastTag = last.split('/').at(-1) ?? '';
  if (!newer(tag, lastTag)) throw new Error('The train version must be newer than the last release tag');
  const previous = git(['rev-parse', `${last}^{commit}`]);
  const prepared = refs.includes(branchRef) ? git(['rev-parse', branchRef]) : undefined;
  const required = (values.require ?? []).map(commit => {
    if (!/^[a-f0-9]{7,40}$/u.test(commit)) throw new Error('Use a commit SHA for each --require');
    if (!ancestor(commit, mainRef)) throw new Error(`Required commit ${commit} is absent from main`);
    return git(['rev-parse', `${commit}^{commit}`]);
  });
  const cadence = releaseDueFromRefs(refs, git, Date.now());
  if (!prepared && (cadence.status === 'no-change' || (cadence.status === 'waiting' && !values['on-demand']))) {
    throw new Error(reminderLine(cadence));
  }

  const unattributed = attributionGap(process.env, prepared !== undefined);
  if (unattributed !== undefined) throw new Error(unattributed);

  const intended = prepared ? git(['rev-parse', `${prepared}^`]) : undefined;
  const candidates = JSON.parse(gh(['run', 'list', '-R', repo, '--workflow', 'ci.yml', '--branch', 'main',
    '--status', 'success', ...(intended ? ['--commit', intended] : []), '--limit', '100',
    '--json', 'databaseId,headSha,status,conclusion'])) as Run[];
  const green = candidates.filter(row => row.conclusion === 'success' && row.status === 'completed' &&
    sha.test(row.headSha) && (!intended || row.headSha === intended) && ancestor(previous, row.headSha) &&
    ancestor(row.headSha, mainRef) && required.every(commit => ancestor(commit, row.headSha)));
  green.sort((a, b) => a.headSha === b.headSha ? b.databaseId - a.databaseId : ancestor(a.headSha, b.headSha) ? 1 : -1);
  const source = green.find(row => provesTrainSource(runView(row.databaseId), row.headSha));
  if (!source) throw new Error('No eligible green main CI contains the previous release');
  if (!prepared && Number(git(['rev-list', '--no-merges', '--count', `${cadence.build}..${source.headSha}`])) === 0) {
    throw new Error(`Newest eligible green main has no changes since ${cadence.tag}`);
  }
  if (values['dry-run']) {
    console.log(JSON.stringify({ release: tag, source: source.headSha, mainCi: source.databaseId, prepared, required }));
    return;
  }

  const unlock = pidLock(join(root, '.git', `release-train-${tag}.lock`));
  if (!unlock) throw new Error(`Another train command for ${tag} is active`);
  let unlockStaging: (() => void) | undefined;
  let stagingVerdict: string | undefined;
  let scratch: ReturnType<typeof openReleaseRun> | undefined;
  let evidence: string | undefined;
  try {
    scratch = openReleaseRun(root, 'train');
    const out = scratch.work, saved = join(dirname(scratch.proof), `train-${tag}-${source.headSha.slice(0, 8)}`);
    const legTree = async (at: string, name: string) => {
      const leg = cutTree(root, at, join(out, name));
      if (!existsSync(join(leg, 'node_modules/.pnpm/lock.yaml'))) {
        await runLogged(leg, join(out, `${name}-install.log`), 'pnpm', ['install', '--frozen-lockfile', '--config.ci=false']);
      }
      return leg;
    };
    evidence = saved;
    mkdirSync(saved, { recursive: true, mode: 0o700 });
    const localDir = localAttemptDir(saved, dir => existsSync(join(dir, 'verdict.json'))
      && localQaGap(read(join(dir, 'verdict.json')) as QaVerdict | undefined, source.headSha, tag) !== undefined);
    const local = join(localDir, 'verdict.json');
    // QA 11-25 row 88: local QA runs from the train's own clone at the cut, never the canonical checkout.
    if (!existsSync(local)) {
      const cut = await legTree(source.headSha, 'cut-tree');
      await runLogged(cut, join(out, 'local.log'), 'bash', [
        'src/scripts/browser-lane.sh', '--max', '20', process.execPath, 'src/scripts/staging-qa.mjs',
        '--local', '--release', tag, '--build', source.headSha, '--out', localDir,
      ], { ...process.env, BROWSER: 'none' });
      const dirt = treeDirt(cut, 'Local QA');
      if (dirt !== undefined) throw new Error(dirt);
    }
    const gap = localQaGap(read(local) as QaVerdict | undefined, source.headSha, tag);
    if (gap !== undefined) throw new Error(`Local QA refused the cut: ${gap}`);
    if (!prepared) {
      receipt(lane, `START ${tag} cut from ${source.headSha.slice(0, 10)}, main CI ${source.databaseId}.`);
      // Kept with the evidence: the run's scratch is removed on exit, and a stopped prepare must still say why.
      const prepare = () => runLogged(root, join(saved, 'prepare.log'), kit, [tag, '--prepare', '--from', source.headSha, '--notes', notes]);
      try {
        await prepare();
      } catch (error) {
        // J505 (opus-rel86, 11-25): v0.1.93's prepare stopped when its push gate saw the installed inputs change mid-gate
        // (a land refreshed the shared install). That is passing; repo-kit rolls back the half-made branch, so prepare once more.
        if (!gateInputsMoved(readFileSync(join(saved, 'prepare.log'), 'utf8'))) throw error;
        receipt(lane, `NOTE ${tag} prepare's push gate saw its installed inputs move mid-gate; preparing once more.`);
        await prepare();
      }
    }
    const build = git(['rev-parse', branchRef]);
    if (git(['rev-parse', `${build}^`]) !== source.headSha || git(['rev-parse', 'HEAD'], tree) !== build ||
        git(['status', '--porcelain'], tree) !== '') throw new Error('The clean release worktree must match the exact published branch');
    receipt(lane, `NOTE ${tag} prepared at ${build.slice(0, 10)}. Exact release CI follows.`);

    const listRelease = () => JSON.parse(gh(['run', 'list', '-R', repo, '--workflow', 'ci.yml', '--branch', branch,
      '--commit', build, '--event', 'push', '--limit', '1', '--json', 'databaseId'])) as { databaseId: number }[];
    let ci = listRelease()[0]?.databaseId;
    for (let poll = 0; ci === undefined && poll < 18; poll++) { await wait(10_000); ci = listRelease()[0]?.databaseId; }
    if (!ci) throw new Error('Exact release CI was not listed');
    // FR6: a release-only build reuses the main CI that proved its cut (source); its own run is the docs lane.
    const releaseCi = await watchRun(ci, join(out, 'release-ci.log'));
    const proved = provesTrainCi(releaseCi, build);
    const reused = !proved && provesReleaseReuse(releaseCi, build, tag, source.headSha, root);
    if (!proved && !reused) {
      throw new Error('Exact release CI did not prove the release build');
    }
    receipt(lane, `DONE ${tag} ${build.slice(0, 10)} exact release CI ${ci} green${reused ? `, reusing main CI ${source.databaseId} at the cut` : ''}.`);

    // J505 (opus-rel86, 11-25): npm next needs only an admission (J475's exact green release CI, or the staging
    // candidate's), so a release whose staging waits behind another still reaches npm next.
    const publishNext = async (input: { staging_build: string; staging_qualification: string }, beforeDispatch?: () => Promise<void>) => {
    const publish = join(saved, 'npm-next-run.json');
    const previousRun = read(publish) as {build: string; run?: number} | undefined;
    let run = previousRun?.build === build ? previousRun.run : undefined;
    if (run === undefined) {
      const history = JSON.parse(gh(['run', 'list', '-R', repo, '--workflow', 'npm-publish.yml', '--branch', 'main',
        '--event', 'workflow_dispatch', '--limit', '100', '--json', 'displayTitle,databaseId'])) as { displayTitle: string; databaseId: number }[];
      run = history.find(row => row.displayTitle === `npm next ${build}`)?.databaseId;
    }
    if (run === undefined) {
      if (previousRun) throw new Error('An earlier exact npm dispatch is still unconfirmed in Actions');
      await beforeDispatch?.();
      record(publish, { build });
      const result = gh(['workflow', 'run', 'npm-publish.yml', '-R', repo, '--ref', 'main', '--json'], JSON.stringify(input));
      run = Number(/actions\/runs\/(\d+)/u.exec(result)?.[1]);
      if (!Number.isSafeInteger(run) || run <= 0) throw new Error('Could not confirm the npm next dispatch');
    }
    if (!Number.isSafeInteger(run) || run <= 0) throw new Error('The recorded npm next run is invalid');
    record(publish, { build, run });
    receipt(lane, `NOTE ${tag} npm next run ${run}.`);
    if (!provesNpmNext(await watchRun(run, join(out, 'npm-next.log')), build)) {
      throw new Error(`Actions run ${run} did not prove npm next for this build`);
    }
    const version = `${tag.slice(1)}-next.${build.slice(0, 8)}`;
    const tgz = `https://registry.npmjs.org/@wildshard/engine/-/engine-${version}.tgz`;
    const deadline = Date.now() + 60 * 60_000;
    while (Date.now() < deadline) {
      try {
        const metadata = JSON.parse(command(root, 'npm',
          ['view', '@wildshard/engine@next', 'version', 'dist', '--json', '--prefer-online'])) as RegistryMetadata;
        const integrity = metadata.dist?.integrity;
        if (metadata.version === version && metadata.dist?.tarball === tgz && integrity?.startsWith('sha512-')) {
          const response = await fetch(tgz, { redirect: 'error', signal: AbortSignal.timeout(45_000) });
          if (response.ok && response.body) {
            const hash = createHash('sha512');
            for await (const chunk of response.body) hash.update(chunk);
            if (`sha512-${hash.digest('base64')}` === integrity) {
              record(join(saved, 'npm-next.json'), { build, version, run, integrityVerified: true });
              receipt(lane, `DONE ${tag} npm next verified ${version} from ${build.slice(0, 10)} run ${run}. SHA-512 matched.`);
              return;
            }
          }
        }
      } catch { /* npm publishes metadata and the tarball separately. */ }
      await wait(15_000);
    }
    throw new Error('Public npm next did not serve the exact verified tarball');
    };

    // J505: a busy staging alias has no say over preparing or proving another release.
    unlockStaging = pidLock(join(root, '.git', 'release-train.lock'));
    if (!unlockStaging) {
      receipt(lane, `NOTE ${tag} is cut and CI is green. Staging is in use: npm next goes out on the release CI now; rerun this command to stage the same build.`);
      await publishNext(releaseCiAdmission(build, ci));
      process.exitCode = 1;
      return;
    }
    const stagingPage = await get(`${stage.origin}/version.json`) as Version | null;
    const liveTag = `v${stagingPage?.clientVersion ?? ''}`;
    if (tagPattern.test(liveTag) && newer(liveTag, tag)) throw new Error(`Staging already serves newer ${liveTag}`);
    receipt(lane, `NOTE ${tag} starting staging.`);
    const stageTree = await legTree(build, 'stage-tree');
    const attemptPath = join(saved, 'staging-attempt.json');
    const attempt = (read(attemptPath) as { attempt: number } | undefined)?.attempt ?? 0;
    if (!Number.isSafeInteger(attempt) || attempt < 0) throw new Error('The staging attempt number is invalid');
    const attemptRoot = (id: number) => join(saved, id === 0 ? 'staging' : `staging-${id}`);
    const previousVerdictPath = join(attemptRoot(attempt), 'verdict.json');
    const previousVerdict = read(previousVerdictPath) as Verdict | undefined;
    if (previousVerdict && previousVerdict.build !== build) throw new Error('The prior staging verdict names another build');
    const retry = previousVerdict?.hold === true || (!previousVerdict && existsSync(attemptRoot(attempt)));
    const previousTour = previousVerdict?.deploy?.zoneEntry;
    const resume = retry && previousTour?.build === build && previousTour.pass === false && previousTour.failures?.length
      ? [`--zone-entry-resume=${previousVerdictPath}`] : [];
    const deployRoot = join(out, 'deployment');
    const deployEvidence = attemptRoot(attempt + Number(retry));
    record(attemptPath, { attempt: attempt + Number(retry) });
    const env = { ...process.env, BROWSER: 'none', E7_RELEASE_SIGNING_KEY: readFileSync(join(homedir(), '.config/wildshard/e7-release-signing.pem'), 'utf8') };
    const pageArgs = [`--env-file=${join(homedir(), '.config/wildshard/cook.env')}`, 'src/scripts/page-release.mjs', 'staging'];
    const pageState = join(stageTree, 'tmp/page-release', `staging-${build}.json`);
    const state = () => read(pageState) as { build?: { build?: string }; 'go-live'?: Alias } | undefined;
    const savedAlias = join(saved, 'staging-alias.json');
    const alias = () => state()?.['go-live'] ?? (read(savedAlias) as Alias | undefined);
    const stageVerdict = join(deployEvidence, 'verdict.json');
    stagingVerdict = stageVerdict;
    let pageDone = existsSync(stageVerdict);
    if (!pageDone && state()?.build?.build !== build) await runLogged(stageTree, join(out, 'staging-build.log'), process.execPath,
      [...pageArgs, 'build', '--content'], env);
    const builtDirt = treeDirt(stageTree, 'The staging build');
    if (builtDirt !== undefined) throw new Error(builtDirt);
    const runPage = async () => {
      if (pageDone) return;
      try {
        await runLogged(stageTree, join(out, 'staging.log'), process.execPath,
          [...pageArgs, 'go-live', '--content', `--local-qa=${local}`, `--qa-out=${deployRoot}`, '--wait=60', ...resume], env);
      } catch (error) {
        const dirt = treeDirt(stageTree, 'Staging go-live');
        throw dirt === undefined ? error : new Error(`${error instanceof Error ? error.message : String(error)}\n${dirt}`);
      } finally {
        pageDone = true;
        keepReleaseProof(deployRoot, deployEvidence, ['verdict.json', 'qualification/leg.json', 'zone-entry/zone-entry.json', 'mmo-observer.json']);
        const live = state()?.['go-live'];
        if (live?.build === build) record(savedAlias, live);
      }
    };
    // Install the rejection handler before waiting on the early npm handoff.
    const pageResult = failure(runPage());

    const stageTag = `server-staging-${build}`;
    const clientArchives = async () => {
      const names = ['devserver-client.tar.gz', 'preparation-client.tar.gz'];
      const assetList = () => {
        const row = JSON.parse(gh(['release', 'view', stageTag, '-R', repo, '--json', 'isDraft,assets'])) as {isDraft: boolean; assets: Asset[]};
        return row.isDraft ? [] : row.assets;
      };
      const bundle = `engine-server-${build}.tar.gz`;
      let assets: Asset[] = [];
      for (let poll = 0; poll < 60; poll++) {
        try { assets = assetList(); } catch { /* Release CI publication may still be queued. */ }
        if (assets.some(asset => asset.name === bundle && asset.state === 'uploaded')) break;
        if (pageDone) throw new Error('Immutable staging release was not published');
        await wait(15_000);
      }
      const currentTag = git(['ls-remote', '--tags', 'origin', `refs/tags/${stageTag}`, `refs/tags/${stageTag}^{}`]);
      if (!currentTag.split('\n').some(line => line.split(/\s+/u)[0] === build) || !assets.some(asset => asset.name === bundle)) {
        throw new Error('The immutable staging tag and server bundle must match the build');
      }
      const ready = (name: string) => assets.find(asset => asset.name === name && asset.state === 'uploaded' && asset.size > 0 && digest.test(asset.digest));
      for (const name of names) {
        if (ready(name)) continue;
        const archive = join(out, name);
        const preparation = name === names[1];
        if (!existsSync(archive)) await runLogged(tree, join(out, 'client-archives.log'), 'python3', [
          'src/scripts/heavy-lane.py', 'build', '--', process.execPath, 'src/scripts/devserver-client.mjs',
          ...(preparation ? ['--kind', 'preparation'] : []), '--out', archive,
        ], { ...process.env, BROWSER: 'none', WS_BUILD_ID: build });
        const version = JSON.parse(command(tree, 'tar', ['-xOzf', archive, './version.json'])) as Version;
        if (version.build !== build || version.clientVersion !== tag.slice(1) || Boolean(version.preparationOnly) !== preparation) {
          throw new Error(`Client archive does not match ${tag}`);
        }
        assets = assetList();
        if (!ready(name)) {
          try { gh(['release', 'upload', stageTag, archive, '-R', repo]); }
          catch { /* A hosted uploader may have published this same archive. */ }
          assets = assetList();
          if (ready(name)?.digest !== await sha256(archive)) throw new Error(`Could not verify the uploaded ${name}`);
        }
      }
      const verified = names.map(ready);
      if (verified.some(asset => asset === undefined)) throw new Error('Both immutable client archives are required');
      record(join(saved, 'author-archives.json'), { stageTag, assets: verified });
      receipt(lane, `DONE ${tag} ${build.slice(0, 10)} immutable staging tag and both client archives verified.`);
    };
    const archives = failure(clientArchives());

    const npmNext = async () => {
      const candidateProof = () => {
        const active = nextAdmission(build, tag, ci, alias(), read(join(deployRoot, ...qualification)) as Leg | undefined);
        if (active) return active;
        for (let id = attempt + Number(retry); id >= 0; id--) {
          const proof = nextAdmission(build, tag, ci, alias(), read(join(attemptRoot(id), ...qualification)) as Leg | undefined);
          if (proof) return proof;
        }
        return undefined;
      };
      let input = candidateProof();
      while (!input) {
        if (pageDone) break;
        await wait(3_000);
        input = candidateProof();
      }
      if (!input) throw new Error('No passing candidate and matching staging alias for npm next');
      const { serial } = JSON.parse(input.staging_qualification) as { serial: number };
      await publishNext(input, async () => {
        await requireSignedAlias(build, tag, serial);
        receipt(lane, `DONE ${tag} staging ${build} rooms/${serial}. Live QA and J451 follow.`);
      });
    };
    const npm = failure(npmNext());
    const failures = (await Promise.all([pageResult, archives, npm])).filter(error => error !== undefined);
    if (failures.length > 0) throw new Error(failures.map(error => error.message).join('\n'));
    const verdict = read(stageVerdict) as Verdict | undefined;
    if (verdict?.build !== build || verdict.status !== 'pass' || verdict.hold !== false) throw new Error(`Staging is held. See ${stageVerdict}`);
    receipt(lane, `DONE FS28 ${tag} staging QA and J451 passed. Delivery evidence in ${saved}.`);
  } catch (error) {
    const failed = stagingVerdict === undefined ? undefined : (read(stagingVerdict) as Verdict | undefined)?.deploy?.zoneEntry?.failures?.[0];
    const pair = failed && /^[a-z0-9_-]+$/u.test(failed.from) && /^[a-z0-9_-]+$/u.test(failed.to)
      ? ` ${failed.from} -> ${failed.to}.` : '';
    // J505: the folder a HOLD names holds its reason and the failed leg's log, before the scratch is removed.
    if (evidence !== undefined) writeHold(evidence, error instanceof Error ? error.message : String(error));
    receipt(lane, `HOLD ${tag} train.${pair}${evidence === undefined ? '' : ` See ${evidence}.`}`);
    throw error;
  } finally {
    try { scratch?.close(); }
    finally { unlockStaging?.(); unlock(); }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.once('SIGINT', () => stopping.abort());
  process.once('SIGTERM', () => stopping.abort());
  try { await main(process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
