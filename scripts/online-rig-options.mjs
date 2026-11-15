/** Admit the rig before a key read, build, database or listener can start.
 * @param {{saves?: 'memory', pgBin?: string, pgData?: string, socket: string}} options */
export function rigOptions({ saves, pgBin = '', pgData = '', socket }) {
  const target = new URL(socket);
  if (!['ws:', 'wss:'].includes(target.protocol) || !['127.0.0.1', '[::1]'].includes(target.hostname) || target.username !== '' || target.password !== '') throw new Error('A rig signs loopback WebSocket addresses only');
  const memory = saves === 'memory' || pgBin === 'memory:';
  if (!memory && (pgBin === '' || pgData === '')) throw new Error('A rig requires Postgres paths or saves: memory');
  return { memory, pgBin, pgData };
}
