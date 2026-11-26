// EG26: identical admitted pin bytes and real fixed inputs in V8 and a JavaScriptCore worker.
// oxlint-disable-next-line import/no-unassigned-import -- Install deterministic simulation Math before any game module evaluates.
import "../../shared/engine/core/portableMathFirst";
import { portableMathInstalled } from "../../shared/engine/core/portableMath";
import { loadRapier } from "../../shared/engine/physics/rapier";
import { SaveStore } from "../../shared/engine/saves/store";
import { leadPlayer } from "../../shared/engine/sim/leadPlayer";
import { serializeSimSnapshot, snapshotSimHostBytes } from "../../shared/engine/sim/snapshot";
import { readServerFolder } from "../../server/host/standalone/serverFolder";
import { openCellWorld } from "../../server/host/standalone/cellWorld";
import type { NetCommand } from "@wildshard/wire/netCommand";

export interface TapeRequest {
  base: string;
  build: string;
  tape: readonly NetCommand[];
}
export interface TapeWitness {
  slug: string;
  ticks: number;
  hashes: string[];
  start: number[];
  end: number[];
  portableMath: boolean;
  effects: string[];
}
/** Hash the public durable representation without an internal-field golden or float rounding. */
async function sha(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}
/** The normal worker reader still verifies every descriptor and asset, even though transport is localhost. */
export async function playTape(request: TapeRequest): Promise<TapeWitness> {
  if (!portableMathInstalled()) throw new Error("Simulation Math was not installed at entry");
  const deadline = AbortSignal.timeout(60_000);
  const read = async (url: URL): Promise<Uint8Array> => {
    const response = await fetch(url, { signal: deadline });
    if (!response.ok) {
      throw new Error(`Parity input refused: ${response.status} ${url.pathname}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  };
  const rapier = await loadRapier(
    Uint8Array.from(await read(new URL("/rapier.wasm", request.base))),
  );
  const input = await readServerFolder(request.base, () => request.build, read, rapier);
  const cell = await openCellWorld({ instance: "determinism-proof" }, input, undefined, {
    saves: new SaveStore({ local: null, session: null }),
    lone: true,
    wholeSolids: true,
    pageless: true,
  });
  try {
    const player = leadPlayer(cell.host),
      point = (): number[] => [player.position.x, player.position.y, player.position.z];
    const start = point(),
      hashes: string[] = [],
      effects: string[] = [];
    for (const command of request.tape) {
      deadline.throwIfAborted();
      cell.step([{ client: 0, player: player.id, command, acts: [], extra: null, still: false }]);
      const snapshot = serializeSimSnapshot(snapshotSimHostBytes(cell.host));
      hashes.push(await sha(new TextEncoder().encode(snapshot)));
      effects.push(await sha(new TextEncoder().encode(JSON.stringify(cell.effects()))));
    }
    return {
      slug: input.shard.identity.slug,
      ticks: request.tape.length,
      hashes,
      effects,
      portableMath: portableMathInstalled(),
      start,
      end: point(),
    };
  } finally {
    cell.dispose();
  }
}
