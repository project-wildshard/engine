/** Controlled blank-page experiment; serialized into the existing Simulator helper. */
export async function runWasmMemoryProbe() {
  const pause = ms => new Promise(resolve => { setTimeout(resolve, ms); });
  // (module (import "env" "memory" (memory 1 1))) -- no code, exports or start.
  const module = new WebAssembly.Module(new Uint8Array([
    0,97,115,109,1,0,0,0,2,16,1,3,101,110,118,6,109,101,109,111,114,121,2,1,1,1,
  ]));
  const heldMemories = [], heldInstances = [], weak = [], finalized = [], constructions = [];
  const registry = typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry(id => { finalized.push(id); }) : null;
  const weakAvailable = typeof WeakRef === 'function';
  let index = 0;
  const pair = (phase, tracked) => {
    const strongBefore = heldMemories.length, startMs = performance.now();
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
    const instance = new WebAssembly.Instance(module, { env: { memory } });
    const endMs = performance.now(), id = ++index;
    heldMemories.push(memory); heldInstances.push(instance);
    constructions.push({ id, phase, strongBefore, strongAfter: heldMemories.length, startMs, endMs });
    if (tracked) {
      if (weakAvailable) weak.push({ id, memory: new WeakRef(memory), instance: new WeakRef(instance) });
      registry?.register(memory, `memory:${id}`);
      registry?.register(instance, `instance:${id}`);
    }
  };
  const release = () => { heldMemories.length = 0; heldInstances.length = 0; };
  const verifyHeld = () => {
    if (heldMemories.length !== 42 || heldInstances.length !== 42
      || !heldMemories.every(memory => memory instanceof WebAssembly.Memory)
      || !heldInstances.every(instance => instance instanceof WebAssembly.Instance)) throw new Error('Strong native bank differs before release');
    return 42;
  };
  try {
    for (let i = 0; i < 38; i++) { await pause(50); pair(i < 4 ? 'fresh-baseline' : 'hold-to-38', true); }
    for (let i = 0; i < 4; i++) { await pause(50); pair('retained-probe', true); }
    const strongBankVerifiedBeforeDrop = verifyHeld(); // Future use of every target, outside native timings; no WeakRef read.
    const dropMs = performance.now();
    release(); // This helper returns before any yield or post-drop construction.
    await pause(200); await pause(0);
    for (let i = 0; i < 4; i++) { await pause(50); pair('post-drop-probe', false); }
    await pause(1000);
    // No WeakRef dereference occurs before this final checkpoint. A surviving
    // target is not proof of a retaining owner; collection may never have run.
    const reachability = weak.map(row => ({ id: row.id,
      memoryAlive: row.memory.deref() !== undefined, instanceAlive: row.instance.deref() !== undefined }));
    return { diagnostic: 'blank-fixed-one-page-memory', origin: performance.timeOrigin,
      constructions, dropMs, strongBankVerifiedBeforeDrop, checkpointMs: performance.now(), strongHeldAtCheckpoint: heldMemories.length,
      weakAvailable, finalizationAvailable: registry !== null, reachability, finalized: [...finalized],
      note: 'Controlled blank heap, not app retention or live-count proof. No forced GC, heap snapshot, rAF or game watcher. No collection means UNKNOWN.' };
  } finally { release(); }
}
