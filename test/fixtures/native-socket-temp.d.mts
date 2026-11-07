/** Short native socket address; its target remains under the owned profile. */
export function nativeSocketTemporary(profile: string): Promise<{
  readonly path: string;
  dispose(): Promise<void>;
}>;
