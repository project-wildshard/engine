// @vitest-environment node
import { expect, test } from 'vitest';
import { soakInspector } from '../scripts/soak/inspector.mjs';

class WireEvent extends Event {
  constructor(readonly data: string) { super('message'); }
}
class Socket extends EventTarget {
  static current: Socket | undefined;
  readonly sent: string[] = [];
  constructor(_url: string, _options: {maxPayload: number}) {
    super(); Socket.current = this;
    queueMicrotask(() => { this.dispatchEvent(new Event('open')); });
  }
  once(type: 'open' | 'error', listener: (error: Error) => void): void {
    this.addEventListener(type, () => { listener(new Error(type)); }, {once: true});
  }
  on(type: 'message' | 'close' | 'error', listener: (data: {toString: () => string}) => void): void {
    this.addEventListener(type, event => { listener({toString: () => event instanceof WireEvent ? event.data : type}); });
  }
  send(message: string): void { this.sent.push(message); }
  close(): void { this.dispatchEvent(new Event('close')); }
  message(message: object): void { this.dispatchEvent(new WireEvent(JSON.stringify(message))); }
}
async function fixture() {
  const driver = soakInspector('ws://fixture', Socket);
  await driver.opened;
  const socket = Socket.current;
  if (socket === undefined) throw new Error('Missing socket');
  return {driver, socket};
}

test('bare Runtime before target creation reproduces the ordinary protocol refusal', async () => {
  const {driver, socket} = await fixture();
  try {
    const evaluation = driver.evaluate('1+2');
    expect(socket.sent).toEqual([JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'1+2',returnByValue:true}})]);
    socket.message({id:1,error:{message:"'Runtime' domain was not found"}});
    await expect(evaluation).rejects.toThrow("'Runtime' domain was not found");
  } finally { driver.close(); }
});

test('socket open does not admit Runtime before the delayed Safari page target', async () => {
  const {driver, socket} = await fixture();
  try {
    const evaluation = (async () => {
      await driver.waitForPageTarget(1000);
      return driver.evaluate('1+2');
    })();
    socket.message({method:'Target.targetCreated',params:{targetInfo:{type:'worker',targetId:'worker'}}});
    await Promise.resolve();
    expect(socket.sent).toEqual([]);
    socket.message({method:'Target.targetCreated',params:{targetInfo:{type:'page',targetId:'page-1'}}});
    await driver.waitForPageTarget();
    expect(socket.sent).toEqual([JSON.stringify({id:2,method:'Target.sendMessageToTarget',params:{targetId:'page-1',message:JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'1+2',returnByValue:true}})}})]);
    socket.message({method:'Target.dispatchMessageFromTarget',params:{message:JSON.stringify({id:1,result:{result:{value:3}}})}});
    expect(await evaluation).toBe(3);
    socket.message({method:'Target.didCommitProvisionalTarget',params:{newTargetId:'page-2'}});
    await driver.waitForPageTarget();
  } finally { driver.close(); }
});

test('missing page target expires within its supplied budget and a later wait can qualify', async () => {
  const {driver, socket} = await fixture();
  try {
    await expect(driver.waitForPageTarget(5)).rejects.toThrow('Safari inspector timeout: page target');
    const ready = driver.waitForPageTarget(1000);
    socket.message({method:'Target.didCommitProvisionalTarget',params:{newTargetId:'page-2'}});
    await ready;
    expect(socket.sent).toEqual([]);
  } finally { driver.close(); }
});

test.each(['close', 'error'])('socket %s refuses all target waiters and future waits immediately', async event => {
  const {driver, socket} = await fixture();
  const first = expect(driver.waitForPageTarget()).rejects.toThrow('Inspector closed');
  const second = expect(driver.waitForPageTarget()).rejects.toThrow('Inspector closed');
  socket.dispatchEvent(new Event(event));
  await Promise.all([first, second]);
  await expect(driver.waitForPageTarget()).rejects.toThrow('Inspector closed');
  driver.close();
});
