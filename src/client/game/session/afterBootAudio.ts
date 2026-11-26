/** QA 11-25 row 72: the audio a boot decodes after control (the deferred level audio, then the late title music) runs
 * beside the first playable frames, so a reading taken at control can catch it at any point: Nalati's control ledger read
 * 2.65 MB of audio or 23.02 MB by timing alone. This names that work's state, so a meter can wait for it to settle. */
export type AfterBootAudioState = 'none' | 'pending' | 'done';

export interface AfterBootAudio {
  /** Run the after-control decode once; its state reads `pending` until it ends, however it ends. */
  start: (work: () => Promise<void>) => Promise<void>;
  state: () => AfterBootAudioState;
}

export function observeAfterBootAudio(): AfterBootAudio {
  let state: AfterBootAudioState = 'none';
  return {
    start: async work => {
      if (state !== 'none') throw new Error('After-boot audio started twice');
      state = 'pending';
      try { await work(); } finally { state = 'done'; }
    },
    state: () => state,
  };
}
