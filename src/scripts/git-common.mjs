// DEV-SPEED DS6: repo-wide Git-private files (the Simulator quiet marker,
// commit-lanes.jsonl, push.log, browser slot locks) live in the common Git
// dir, which every linked worktree shares. In a linked worktree `.git` is a
// file, so `<root>/.git/<name>` is never the right path.
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

/** The absolute common-dir path of a repo-wide Git-private file.
 * @param {string} name @param {string} [cwd] */
export function gitCommonPath(name,cwd=process.cwd()){
 const common=execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 return join(common,name);
}
