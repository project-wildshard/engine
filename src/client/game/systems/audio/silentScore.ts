import type { Scope } from '@wildshard/engine/app/scope';

/** Silence this score's output, preserving the user's volume setting and the other sound buses. */
export function installSilentScore(music: { silence: (scope: Scope) => void }, scope: Scope): void {
  music.silence(scope);
}
