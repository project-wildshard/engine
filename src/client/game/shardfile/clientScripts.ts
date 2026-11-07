import { ClientScriptLane, type ClientScriptObservation } from '@wildshard/engine/script/client';
import type { DeclaredScriptWorld } from '@wildshard/engine/script/state';
import { clientScriptRules, parseClientScripts, type ClientScriptContent, type ClientScriptTarget } from '@wildshard/format/clientScripts';

/** A caller-owned numeric destination for a synchronous target capture. */
export interface ClientScriptTargetCapture { x: number; y: number; z: number; frozen: boolean }

/** Capture one live numeric point before field reads. A supplied destination
 * belongs to this bridge call, including a separate one for nested observers. */
export function captureClientScriptPosition(position: Readonly<{ x: number; y: number; z: number }> | undefined,
  frozen: boolean): { position: [number, number, number]; frozen: boolean };
export function captureClientScriptPosition(position: Readonly<{ x: number; y: number; z: number }> | undefined,
  frozen: boolean, capture: ClientScriptTargetCapture): undefined;
export function captureClientScriptPosition(position: Readonly<{ x: number; y: number; z: number }> | undefined,
  frozen: boolean, capture?: ClientScriptTargetCapture): { position: [number, number, number]; frozen: boolean } | undefined {
  if (capture === undefined) return { position: position === undefined ? [0, 0, 0] : [position.x, position.y, position.z], frozen };
  capture.x = position === undefined ? 0 : position.x;
  capture.y = position === undefined ? 0 : position.y;
  capture.z = position === undefined ? 0 : position.z;
  capture.frozen = frozen; return undefined;
}

/** Trusted input ports; the actor comes from the page, and observation never exposes a simulation object to bytecode. */
export interface ShardfileClientScriptPorts {
  actorId: string; state?: Pick<DeclaredScriptWorld, 'viewField'>;
  observe: (target: ClientScriptTarget) => { position: readonly [number, number, number]; frozen: boolean };
  /** Fill numeric capture, or return an iterable observation. Legacy observers retain their one-argument call. */
  observeInto?: (target: ClientScriptTarget, capture: ClientScriptTargetCapture) => { position: readonly [number, number, number]; frozen: boolean } | undefined;
  memoryBytes?: number;
}
/** Construct one isolated presentation lane and copy only the selected public/owner values on each presentation tick. */
export function createShardfileClientScripts(source: ClientScriptContent, assets: ReadonlyMap<string, Uint8Array>, ports: ShardfileClientScriptPorts): {
  lane: ClientScriptLane; targets: readonly { entity: number; target: ClientScriptTarget }[]; step: (tick: number) => void; dispose: () => void;
} {
  const declaration = parseClientScripts(source.clientScripts), problems = clientScriptRules({ ...source, clientScripts: declaration });
  if (problems.length > 0) throw new Error(problems.join('; '));
  const fieldNames = declaration.bindings.map((binding) => binding.reads.map((read) => {
    const field = source.state[read.scope].find((row) => row.id === read.id); if (!field) throw new Error('Unknown client state field');
    return { scope: read.scope, name: field.name };
  }));
  const modules = [...new Set(declaration.bindings.map((binding) => binding.module))].map((moduleRef) => {
    const bytes = assets.get(moduleRef); if (!bytes) throw new Error('Missing admitted client module');
    return { name: moduleRef, bytes, seedLo: source.identity.seed % 4294967296, seedHi: Math.floor(source.identity.seed / 4294967296) };
  });
  if (declaration.bindings.some((b) => b.reads.length > 0) && ports.state === undefined) throw new Error('Declared client reads require an owned state view');
  const lane = new ClientScriptLane({ modules, divisor: declaration.divisor, ...(ports.memoryBytes === undefined ? {} : { memoryBytes: ports.memoryBytes }),
    bindings: declaration.bindings.map((b) => ({ module: b.module, entity: b.entity, name: b.name, readCount: b.reads.length, parameters: b.parameters, pose: b.pose, maxOffset: b.maxOffset, minScale: b.minScale, maxScale: b.maxScale,
      emitters: b.emitters.map((e) => ({ id: e.id, perTick: e.perTick, live: e.live, lifetimeTicks: e.lifetimeTicks })) })) });
  // The lane admits and copies the entire map synchronously. Keep the bridge's
  // private numeric rows between ticks; nested observation callbacks borrow a
  // separate frame, so they cannot overwrite an outer tick's completed rows.
  interface ObservationFrame {
    observations: Map<number, ClientScriptObservation>;
    rows: { position: [number, number, number]; frozen: boolean; values: number[] }[];
    captures: ClientScriptTargetCapture[];
  }
  const frames: ObservationFrame[] = [], readsState = declaration.bindings.some((b) => b.reads.length > 0);
  let depth = 0;
  return { lane, targets: declaration.bindings.map((b) => ({ entity: b.entity, target: structuredClone(b.target) })), dispose: () => lane.dispose(), step: (tick) => {
    const state = readsState ? ports.state : undefined, at = depth++;
    try {
      let frame = frames[at];
      if (frame === undefined) {
        frame = { observations: new Map(), rows: [], captures: [] }; frames[at] = frame;
        for (const binding of declaration.bindings) {
          const row: ObservationFrame['rows'][number] = { position: [0, 0, 0], frozen: false, values: [] };
          frame.rows.push(row); frame.observations.set(binding.entity, row);
          frame.captures.push({ x: 0, y: 0, z: 0, frozen: false });
        }
      }
      for (let index = 0; index < declaration.bindings.length; index++) {
        const binding = declaration.bindings[index]; if (binding === undefined) throw new Error('Missing client binding');
        const capture = frame.captures[index]; if (capture === undefined) throw new Error('Missing client target capture');
        const into = ports.observeInto, captured = into !== undefined;
        const observed = into === undefined ? ports.observe(binding.target) : into.call(ports, binding.target, capture);
        const reads = fieldNames[index], row = frame.rows[index];
        if (reads === undefined || row === undefined) throw new Error('Missing client read contract');
        for (let field = 0; field < reads.length; field++) {
          const read = reads[field]; if (read === undefined) throw new Error('Missing client read contract');
          const value = state?.viewField(ports.actorId, read.scope, read.name);
          if (value === undefined) throw new Error('Private or missing client state field');
          row.values[field] = value;
        }
        row.values.length = reads.length;
        // Retain the original iterable-copy semantics (including an authored
        // iterator) and the position-before-frozen getter order.
        const position: number[] = row.position;
        if (captured && observed === undefined) {
          position[0] = capture.x; position[1] = capture.y; position[2] = capture.z;
          position.length = 3; row.frozen = capture.frozen;
        } else {
          if (observed === undefined) throw new TypeError('Missing client observation');
          let coordinate = 0; for (const value of observed.position) position[coordinate++] = value;
          position.length = coordinate; row.frozen = observed.frozen;
        }
      }
      lane.stepWithoutResults(tick, frame.observations);
    } finally { depth--; }
  } };
}
