import * as v from 'valibot';
import { CodeRetentionSchema, type CodeRetention } from '../../../shared/host/codeRetention';
import { SignedSchema } from '../../../shared/host/releaseRows';

/** Authenticate the page's code-retention file with the release trust root. Match a freshly verified release's channel/build to
 * refuse a signed document from a different channel or older release. This says nothing about server wire compatibility. */
export async function readSignedCodeRetention(text: string, publicKey: string, expected: { readonly channel: CodeRetention['channel']; readonly engineBuild: string }): Promise<CodeRetention> {
  const signed = v.parse(SignedSchema, JSON.parse(text));
  if (!/^(?:[0-9a-f]{2})+$/iu.test(publicKey)) throw new Error('Invalid code-retention public key');
  const bytes = Uint8Array.from(publicKey.match(/../gu) ?? [], byte => Number.parseInt(byte, 16));
  const key = await crypto.subtle.importKey('spki', bytes, { name: 'Ed25519' }, false, ['verify']);
  if (!/^[0-9a-f]{128}$/iu.test(signed.signature)) throw new Error('Invalid code-retention signature');
  const signature = Uint8Array.from(signed.signature.match(/../gu) ?? [], byte => Number.parseInt(byte, 16));
  if (!await crypto.subtle.verify('Ed25519', key, signature, new TextEncoder().encode(signed.body))) throw new Error('Bad code-retention signature');
  const metadata = v.parse(CodeRetentionSchema, JSON.parse(signed.body));
  if (metadata.channel !== expected.channel || metadata.engineBuild !== expected.engineBuild) throw new Error('Code-retention channel/build differs from the verified release');
  return metadata;
}
/** Read only this page origin, fresh; a missing legacy file is unknown. A failed authentication never authorizes retirement. */
export async function fetchCodeRetention(publicKey: string, expected: { readonly channel: CodeRetention['channel']; readonly engineBuild: string }, read: typeof fetch = fetch): Promise<CodeRetention | null> {
  const response = await read('/code-retention.json', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Code-retention read failed');
  return readSignedCodeRetention(await response.text(), publicKey, expected);
}
