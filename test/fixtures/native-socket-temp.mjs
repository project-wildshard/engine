// The native socket name must fit sockaddr_un; only its short symlink is outside
// repository scratch. Chrome's actual temporary files stay inside its own profile.
// oxlint-disable-next-line import/no-nodejs-modules -- Own and reap the native socket alias and profile-local bytes.
import {mkdir, mkdtemp, rm, symlink} from 'node:fs/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep all actual native temporary data in the owned profile.
import {resolve} from 'node:path';

/** @param {string} profile */
export async function nativeSocketTemporary(profile) {
  const target = resolve(profile, 'native-tmp');
  await mkdir(target);
  const alias = await mkdtemp('/tmp/wsesc-');
  try {
    const path = resolve(alias, 't');
    await symlink(target, path, 'dir');
    return {path, dispose: () => rm(alias, {recursive: true, force: true})};
  } catch (error) {
    await rm(alias, {recursive: true, force: true});
    throw error;
  }
}
