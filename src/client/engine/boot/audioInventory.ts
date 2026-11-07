import type { BootSpec } from '../../../shared/engine/level/spec';

export interface BootAudioFiles { readonly music: string[]; readonly sfx: string[] }
const inventories = new WeakMap<BootSpec, Promise<BootAudioFiles>>();
const ready = new WeakMap<BootSpec, BootAudioFiles>();

/** Read declared audio URLs without changing a legacy loader's receiver or await boundary. */
export function resolveBootAudio(boot: BootSpec | undefined): Promise<readonly string[]> {
  return typeof boot?.audio === 'function' ? boot.audio() : Promise.resolve(boot?.audio ?? []);
}

/** Resolve the authored inventory before a boot/prefetch composes its synchronous request list. */
export function prepareBootAudio(boot: BootSpec | undefined): Promise<void> {
  if (boot?.audio === undefined) return Promise.resolve();
  let pending = inventories.get(boot);
  if (pending === undefined) {
    pending = resolveBootAudio(boot).then((files) => {
      const music: string[] = [], sfx: string[] = [];
      for (const file of files) {
        if (file.startsWith('/assets/music/')) music.push(file);
        else if (file.startsWith('/assets/sfx/')) sfx.push(file);
        else throw new Error(`Boot audio inventory has an unsupported path: ${file}`);
      }
      const result = { music, sfx }; ready.set(boot, result); return result;
    });
    inventories.set(boot, pending);
    void pending.catch(() => { inventories.delete(boot); ready.delete(boot); });
  }
  return pending.then(() => undefined);
}

export function bootAudioFiles(boot: BootSpec | undefined): BootAudioFiles | undefined {
  return boot === undefined ? undefined : ready.get(boot);
}
