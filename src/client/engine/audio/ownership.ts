import { currentOwner } from '../../../shared/engine/app/ownership';

/** Legacy sound makers keep their graph; the level owns only scheduled source handles. */
export function ownAudioSource<T extends AudioScheduledSourceNode>(source: T): T {
  const scope = currentOwner();
  if (!scope) return source;
  let ended = false;
  const forget = scope.capture('sounds', () => {
    if (!ended) {
      try { source.stop(); } catch (error) { if (!(error instanceof DOMException && error.name === 'InvalidStateError')) throw error; }
    }
    source.disconnect();
  });
  scope.listen(source, 'ended', () => { ended = true; forget(); source.disconnect(); }, { once: true });
  return source;
}
