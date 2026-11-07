#!/usr/bin/env node
// P1-E5.2a: SimHost once had one player, and code that reaches for "the" player cannot run a room. This counts, with the
// type checker, every read of a one-player member of SimHost (the `player` field, its per-player state and its helpers)
// and every `leadPlayer` call in non-test source, however the host is named or destructured. The counts may only fall.
//   node scripts/check-sim-players.mjs            check (fails on a rise; notes a fall)
//   node scripts/check-sim-players.mjs --update   lower lint/sim-players.json to today's counts (it refuses a rise)
//   node scripts/check-sim-players.mjs --list     every site, one per line
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '@typescript/typescript6';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const FILE = resolve(ROOT, 'lint/sim-players.json');
const ABOUT = 'P1-E5.2a: per-file reads of a one-player SimHost member (`members`, which ended at 0) and leadPlayer binds (`lead`: systems not yet per-player) in non-test source, by type, not by spelling (scripts/check-sim-players.mjs). They never rise.';
/** The members that only make sense with exactly one player. */
const MEMBERS = new Set(['player', 'playerImpulse', 'playerFall', 'playerWalk', 'playerMoveScale', 'playerShove', 'playerBoard', 'boardVelocity',
  'playerSwim', 'swimVelocity', 'playerJump', 'playerDash', 'playerDodge', 'modes', 'playerMode', 'playerWading', 'impulsePlayer', 'shovePlayer',
  'dashPlayer', 'dashTo', 'setBoard', 'resetPlayerPose', 'usePlayerDriver', 'useWalkingControl', 'observePlayerMotion', 'hasPlayerMotor',
  'detachPlayerMotor', 'releasePlayerMotor', 'attachPlayerMotor', 'bindExternalPlayer', 'isExternalPlayerObject']);

/** @returns {string[]} */
function sourceFiles() {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src', 'scripts/*.ts', 'scripts/**/*.ts'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0');
  return tracked.filter(path => /\.m?tsx?$/u.test(path) && !/\.d\.m?ts$/u.test(path));
}
const isTest = (/** @type {string} */ path) => /\.test\.m?tsx?$/u.test(path) || /^src\/[^/]+\/test\//u.test(path);

/** @param {ts.Program} program @returns {{ path: string, line: number, name: string }[]} */
function census(program) {
  const checker = program.getTypeChecker(), sites = /** @type {any[]} */ ([]);
  for (const source of program.getSourceFiles()) {
    if (!source.fileName.startsWith(ROOT) || source.fileName.includes('/node_modules/')) continue;
    const path = source.fileName.slice(ROOT.length + 1);
    if (isTest(path) || path === 'src/shared/engine/sim/leadPlayer.ts') continue;
    /** @param {ts.Node} node */
    const visit = node => {
      /** @type {ts.Node | undefined} */ let name; /** @type {ts.Node | undefined} */ let base;
      if (ts.isPropertyAccessExpression(node)) { name = node.name; base = node.expression; }
      else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) { name = node.propertyName ?? node.name; base = node.parent; }
      if (name !== undefined && base !== undefined && ts.isIdentifier(name)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (MEMBERS.has(name.text)) {
          const declaration = checker.getPropertyOfType(checker.getNonNullableType(checker.getTypeAtLocation(base)), name.text)?.declarations?.[0];
          if (declaration !== undefined && ts.isClassLike(declaration.parent) && declaration.parent.name?.text === 'SimHost') sites.push({ path, line, name: name.text });
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'leadPlayer') {
        sites.push({ path, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, name: 'leadPlayer' });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sites;
}

function main(/** @type {string[]} */ argv) {
  const parsed = ts.parseJsonConfigFileContent({ ...ts.readConfigFile(resolve(ROOT, 'tsconfig.json'), path => ts.sys.readFile(path)).config, include: [], files: ['package.json'], references: [] }, ts.sys, ROOT);
  const program = ts.createProgram(sourceFiles().map(path => resolve(ROOT, path)), { ...parsed.options, noEmit: true, incremental: false, composite: false });
  const sites = census(program), counts = /** @type {Record<string, number>} */ ({});
  for (const { path } of sites) counts[path] = (counts[path] ?? 0) + 1;
  if (argv.includes('--list')) for (const { path, line, name } of sites) console.log(`${path}:${line} ${name}`);
  const recorded = /** @type {{ files: Record<string, number> } | null} */ (argv.includes('--seed') ? null : JSON.parse(readFileSync(FILE, 'utf8')));
  const limits = recorded?.files ?? counts, failures = [];
  for (const [path, count] of Object.entries(counts)) if (count > (limits[path] ?? 0)) failures.push(`${path}: ${limits[path] ?? 0} → ${count}`);
  if (failures.length > 0) { console.error(`check-sim-players (P1-E5.2a): one-player uses may only fall:\n  ${failures.join('\n  ')}`); return 1; }
  const lead = sites.filter(site => site.name === 'leadPlayer').length, members = sites.length - lead;
  const summary = `${members} one-player members, ${lead} lead-player binds, in ${Object.keys(counts).length} files`;
  const was = Object.values(limits).reduce((sum, count) => sum + count, 0);
  if (argv.includes('--update') || argv.includes('--seed')) {
    const files = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(FILE, `${JSON.stringify({ about: ABOUT, members, lead, files }, null, 1)}\n`);
    console.log(`check-sim-players: recorded ${summary}`);
    return 0;
  }
  if (sites.length < was) console.warn(`check-sim-players: fell ${was} → ${sites.length}; lower it with --update`);
  console.log(`check-sim-players: ${summary}; none rising`);
  return 0;
}
process.exitCode = main(process.argv.slice(2));
