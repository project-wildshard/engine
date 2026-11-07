import { fitText } from '../../../shared/engine/net/bits';
import { CHAT_WORDS } from './chatWords';
import { GUEST, MAX_NAME_LENGTH } from '../../../shared/engine/net/identity';

// P1-E5.2c (J110, M5): everything a player writes is plain text, and it passes here on the server before anyone reads it.
// A client's own filter would be a suggestion; this one is the rule.

/** Cap a chat line in bytes, so it always fits the wire's one-byte text length. */
export const MAX_CHAT_BYTES = 240;
const LOOKALIKES: Readonly<Record<string, string>> = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
const WORDS: ReadonlySet<string> = new Set(CHAT_WORDS);
/** Tolerates what stands in for letters, so a word cannot hide in look-alikes; only whole words match, so "class" passes. */
const WORD = /[\p{L}\p{N}@$!]+/gu;

/** Whether `word` is on the list once its case, look-alikes and stretched letters are folded. */
function listed(word: string): boolean {
  const folded = word.toLowerCase().replaceAll(/[013457@$!]/gu, char => LOOKALIKES[char] ?? char);
  return WORDS.has(folded) || WORDS.has(folded.replaceAll(/(.)\1+/gu, '$1'));
}
/** Star out every listed word. */
export function filterWords(text: string): string { return text.replaceAll(WORD, word => listed(word) ? '*'.repeat(word.length) : word); }
/** Plain text, one line: no control or invisible characters, runs of space closed up, cut at a whole character. */
export function plainLine(text: string, maxBytes: number): string {
  const line = text.normalize('NFKC').replaceAll(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}]+/gu, ' ').replaceAll(/\s+/gu, ' ').trim();
  return fitText(line, maxBytes).trimEnd();
}
/** A typed Name as others will read it. */
export function cleanName(name: string): string { return filterWords(plainLine(name, MAX_NAME_LENGTH * 3).slice(0, MAX_NAME_LENGTH)) || GUEST.name; }
