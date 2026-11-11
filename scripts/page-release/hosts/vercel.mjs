// The Vercel page host for scripts/page-release.mjs, exactly what the v0.1.9 scratch scripts did (singleplayer
// tmp/codex-release/v019-*-{refresh,promote}.mjs): `vercel pull`, `build-vercel-output.mjs` and `e7-page-routes.mjs`,
// `vercel deploy --prebuilt --skip-domain` (never aliases), authenticated REST reads of the immutable deployment's
// file index, and `vercel promote` as the alias move. A Vercel file's `uid` is the SHA-1 of its bytes (checked on
// v0.1.9 staging dpl_G6iXAuksHU2SLqgPmWcPcwqNf4dK: version.json and index.html both equal their local SHA-1). OV4's hosts/workers.mjs replaces this file and nothing else.
//
// The token is the long-lived ~/.config/vercel/api-token, else the CLI's own (8-hour) auth.json. It goes to the CLI as
// --token (as the scratch scripts and build-vercel-output.mjs pass it) and to REST in a header; it is never logged,
// and page-release.mjs redacts it from any error text.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

export const SCOPE = 'raynos-projects';
export const TEAM = 'team_HPUh311dFa6AoKlBNtS9Oiph';
/** @type {Record<'staging'|'production', {projectName: string, projectId: string, host: RegExp}>} */
export const PROJECTS = {
  staging: {projectName: 'wildshard-e7-staging', projectId: 'prj_FpkS6hGufxXYPuU44ILo1vArz0z6', host: /^https:\/\/wildshard-e7-staging-[a-z0-9-]+\.vercel\.app$/u},
  production: {projectName: 'wildshard-e7', projectId: 'prj_99LWfc8go9eVql5pcT292Tfvp4p7', host: /^https:\/\/wildshard-e7-(?!staging-)[a-z0-9-]+\.vercel\.app$/u},
};

/** @returns {string} */
export function vercelToken() {
  const file = join(homedir(), '.config/vercel/api-token');
  if (existsSync(file)) {
    const token = readFileSync(file, 'utf8').trim();
    if (token !== '') return token;
  }
  const auth = JSON.parse(readFileSync(join(homedir(), 'Library/Application Support/com.vercel.cli/auth.json'), 'utf8'));
  if (typeof auth.token !== 'string' || auth.token === '') throw new Error('no Vercel token: ~/.config/vercel/api-token or `vercel login`');
  return auth.token;
}

/**
 * @param {{token: () => string, exec?: typeof execFileSync, fetch?: typeof fetch}} options
 * @returns {import('../flow.mjs').PageHost}
 */
export function vercelHost({token, exec = execFileSync, fetch: get = fetch}) {
  /** @param {import('../flow.mjs').HostContext} context */
  const project = context => PROJECTS[context.channel.channel];
  /** @param {import('../flow.mjs').HostContext} context */
  const env = context => ({...process.env, VERCEL_PROJECT_ID: project(context).projectId, VERCEL_ORG_ID: TEAM});
  /** @param {import('../flow.mjs').HostContext} context @param {string[]} args @param {Record<string, string>} [extra] */
  const cli = (context, args, extra = {}) => exec('vercel', [...args, '--scope', SCOPE, '--token', token()],
    {cwd: context.root, env: {...env(context), ...extra}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 8 * 1024 * 1024});
  /** @param {string} path */
  const rest = async path => {
    const response = await get(`https://api.vercel.com${path}`, {headers: {Authorization: `Bearer ${token()}`}, redirect: 'error', signal: AbortSignal.timeout(20_000)});
    if (response.status !== 200) throw new Error(`Vercel GET ${path.split('?')[0]} answered ${response.status}`);
    return /** @type {any} */ (await response.json());
  };
  return {
    name: 'vercel',
    buildEnv: context => ({VERCEL_GIT_COMMIT_SHA: context.build, VERCEL_PROJECT_ID: project(context).projectId, VERCEL_ORG_ID: TEAM}),
    outputDir: context => join(context.root, '.vercel/output/static'),
    prepare(context) {
      // One clean clone per channel: a clone linked to the other channel's project is refused, never relinked.
      const {projectName, projectId} = project(context);
      mkdirSync(join(context.root, '.vercel'), {recursive: true});
      const file = join(context.root, '.vercel/project.json');
      if (!existsSync(file)) writeFileSync(file, `${JSON.stringify({projectId, orgId: TEAM, projectName})}\n`, {flag: 'wx'});
      const linked = JSON.parse(readFileSync(file, 'utf8'));
      if (linked.projectId !== projectId || linked.orgId !== TEAM) throw new Error(`${file} links ${linked.projectName ?? linked.projectId}, not ${projectName}: use a separate clone per channel`);
      cli(context, ['pull', '--yes', '--environment', 'production']);
      return Promise.resolve();
    },
    package(context) {
      exec('python3', ['scripts/heavy-lane.py', 'build', '--', 'node', 'scripts/build-vercel-output.mjs'],
        {cwd: context.root, env: {...env(context), VERCEL_BUILD_TOKEN: token()}, stdio: 'inherit'});
      exec('node', ['scripts/e7-page-routes.mjs', '.'], {cwd: context.root, env: env(context), stdio: 'inherit'});
      return Promise.resolve();
    },
    upload(context) {
      const output = String(cli(context, ['deploy', '--prebuilt', '--target=production', '--skip-domain', '--yes', '--json']));
      const deployed = JSON.parse(output);
      if (deployed.status !== 'ok' || deployed.deployment?.readyState !== 'READY') throw new Error('vercel deploy did not report a READY deployment');
      if (!project(context).host.test(deployed.deployment.url)) throw new Error(`deployment ${deployed.deployment.url} is not on ${project(context).projectName}`);
      return Promise.resolve({id: deployed.deployment.id, url: deployed.deployment.url});
    },
    async deployedDigests(context, names) {
      const {id, url} = context.deployment;
      if (!/^dpl_[A-Za-z0-9]+$/u.test(id)) throw new Error(`deployment id ${id}`);
      const metadata = await rest(`/v13/deployments/${id}?teamId=${TEAM}`);
      if (metadata.projectId !== project(context).projectId || metadata.readyState !== 'READY' || `https://${metadata.url}` !== url) throw new Error(`deployment ${id} is not READY on ${project(context).projectName} at ${url}`);
      // Authenticated GETs of the immutable deployment only: never a protection-bypass token or a project change.
      /** @type {Map<string, string>} */
      const files = new Map();
      let count = 0;
      /** @param {any[]} entries @param {string} prefix */
      const visit = (entries, prefix) => {
        for (const entry of entries) {
          if (++count > 32_768) throw new Error('deployment index exceeds bounded inspection');
          if (typeof entry.name !== 'string' || entry.name.includes('/') || entry.name === '.' || entry.name === '..') throw new Error('deployment index has an unsafe name');
          if (entry.type === 'directory') visit(entry.children ?? [], `${prefix}${entry.name}/`);
          else if (entry.type === 'file') files.set(`${prefix}${entry.name}`, entry.uid);
        }
      };
      visit(await rest(`/v6/deployments/${id}/files?teamId=${TEAM}`), '');
      /** @type {Map<string, import('../flow.mjs').Digest>} */
      const digests = new Map();
      for (const name of names) {
        const uid = files.get(`src/.vercel/output/static/${name}`);
        if (uid === undefined || !/^[a-f0-9]{40}$/u.test(uid)) throw new Error(`deployment ${id} has no ${name}`);
        digests.set(name, {algorithm: 'sha1', digest: uid});
      }
      return digests;
    },
    goLive(context) {
      cli(context, ['promote', context.deployment.url, '--yes']);
      return Promise.resolve();
    },
    describe(step, context) {
      const {projectName} = project(context);
      const t = `--scope ${SCOPE} --token <token>`;
      return {
        prepare: [`link .vercel/project.json to ${projectName}`, `run vercel pull --yes --environment production ${t}`],
        package: ['run python3 scripts/heavy-lane.py build -- node scripts/build-vercel-output.mjs', 'run node scripts/e7-page-routes.mjs .'],
        upload: [`run vercel deploy --prebuilt --target=production --skip-domain --yes --json ${t} (${projectName}, unaliased)`],
        deployedDigests: [`GET api.vercel.com /v13/deployments/${context.deployment?.id ?? '<id>'} and its file index: version.json and index.html SHA-1 (READY on ${projectName})`],
        goLive: [`run vercel promote ${context.deployment?.url ?? '<deployment url>'} --yes ${t} (alias ${context.channel.origin})`],
      }[step];
    },
  };
}
