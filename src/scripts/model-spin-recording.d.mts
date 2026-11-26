/** Caller revokes the returned object URL after binary handoff, including failures. */
export function stopSpinRecording(): Promise<{url: string; bytes: number; size: readonly [number, number]; drawn: number}>;
/** Upload the stopped clip's exact native Blob; caller owns URL/route cleanup. */
export function uploadRecordedClip(locations: {source: string; destination: string}): Promise<void>;
