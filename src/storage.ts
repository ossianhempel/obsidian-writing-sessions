interface WriteQueue { pending: Promise<void> }
const key = Symbol.for('writing-sessions.write-queues.v1');
const runtime = globalThis as typeof globalThis & { [key]?: WeakMap<object, WriteQueue> };
const queues = runtime[key] ??= new WeakMap<object, WriteQueue>();

// The registry survives module reloads. A replacement plugin must wait for all
// outgoing writes before loading data; its writes join the same per-vault queue.
export function writeQueue(vault: object): WriteQueue {
  let queue = queues.get(vault);
  if (!queue) { queue = { pending: Promise.resolve() }; queues.set(vault, queue); }
  return queue;
}
